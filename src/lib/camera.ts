import type {
	DziViewerMethods,
	ViewerLifecycleEvent
} from './components/DziViewer/dziViewerTypes.js';
import {
	easeOutCubic,
	findTrackSegment,
	interpolateTarget,
	interpolateViewport,
	isViewportTargetExplicit,
	resolveViewportTarget,
	sampleViewportTrack
} from './transition.js';
import type {
	BoundsTarget,
	EasingFunction,
	Rect,
	Size,
	TransitionCurve,
	Viewport,
	ViewportFitOptions,
	ViewportTarget,
	ViewportTrackStop
} from './types.js';
import { createFrameLimiter, onAbort, pickDefined, prefersReducedMotion } from './cameraUtils.js';
import { nowMs } from './utils.js';
import { viewportsEqual } from './viewport.js';

const DEFAULT_DURATION_MS = 600;
const DEFAULT_SETTLE_DELAY_MS = 120;
const FALLBACK_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

let nextCameraId = 0;

export interface CameraOptions {
	/** Default interpolation path (`'direct'` or `'fly'`, defaults to `'direct'`). */
	readonly curve?: TransitionCurve;
	/** Default easing for timed `goTo` transitions (defaults to `easeOutCubic`). */
	readonly easing?: EasingFunction;
	/** Curvature factor passed to `interpolateZoom.rho(rho)` for `'fly'` transitions. */
	readonly rho?: number;
	/** Default transition duration in ms for `goTo` / `fitBounds` / `fillBounds` (defaults to `600`). */
	readonly duration?: number;
	/** Optional maximum frame rate (frames per second) for timed `goTo` animations (uncapped by default). */
	readonly maxFps?: number;
	/** Snap immediately when the user prefers reduced motion (defaults to `true`). */
	readonly respectReducedMotion?: boolean;
	/**
	 * Re-frame the last non-explicit `goTo` target or `scrub`/`scrubTrack` position when the viewer resizes.
	 * Accepts a getter function so reactive Svelte state can toggle it dynamically. Defaults to `false`.
	 */
	readonly refitOnResize?: boolean | (() => boolean);
	/** Delay in ms after the last `scrub`/`scrubTrack` call before releasing holds (defaults to `120`). */
	readonly settleDelayMs?: number;
	/** Pause viewport tile downloads during transitions and scrubs (defaults to `true`). */
	readonly pauseLoading?: boolean;
	/** Hold pyramid resolution during transitions and scrubs (defaults to `true`). */
	readonly holdResolution?: boolean;
	/** Precache target tiles during transitions and scrubs (defaults to `true`). */
	readonly precache?: boolean;
	/** Called whenever `isTransitioning` changes. */
	readonly onTransitionChange?: (isTransitioning: boolean) => void;
}

export interface TransitionOptions {
	readonly duration?: number;
	readonly maxFps?: number;
	readonly curve?: TransitionCurve;
	readonly easing?: EasingFunction;
	readonly rho?: number;
	readonly respectReducedMotion?: boolean;
	readonly pauseLoading?: boolean;
	readonly holdResolution?: boolean;
	readonly precache?: boolean;
	readonly signal?: AbortSignal;
}

export interface TransitionResult {
	readonly completed: boolean;
	readonly cancelled: boolean;
	readonly viewport: Viewport;
}

export type ScrubPrecacheMode = 'to' | 'both' | false;

export interface ScrubOptions {
	readonly curve?: TransitionCurve;
	/** Easing applied to scrub progress (defaults to linear; does not inherit `CameraOptions.easing`). */
	readonly easing?: EasingFunction;
	readonly rho?: number;
	readonly settleDelayMs?: number;
	readonly pauseLoading?: boolean;
	readonly holdResolution?: boolean;
	/** Which endpoints to precache once per segment (`'to'` default when camera precaching is enabled). */
	readonly precache?: ScrubPrecacheMode;
}

export interface DziCamera {
	/** True while a timed transition is running or a scrub is waiting to settle. */
	readonly isTransitioning: boolean;
	goTo(target: ViewportTarget, options?: TransitionOptions): Promise<TransitionResult>;
	fitBounds(
		bounds?: Rect,
		options?: TransitionOptions & ViewportFitOptions
	): Promise<TransitionResult>;
	fillBounds(
		bounds?: Rect,
		options?: TransitionOptions & ViewportFitOptions
	): Promise<TransitionResult>;
	scrub(
		from: ViewportTarget,
		to: ViewportTarget,
		progress: number,
		options?: ScrubOptions
	): Viewport | null;
	scrubTrack(
		stops: readonly ViewportTrackStop[],
		progress: number,
		options?: ScrubOptions
	): Viewport | null;
	cancel(): void;
	destroy(): void;
}

type ViewerInput = DziViewerMethods | (() => DziViewerMethods | undefined);

/** What the camera last framed, so it can re-frame the same thing after a resize. */
type LastCameraState =
	| { readonly kind: 'goTo'; readonly target: ViewportTarget }
	| {
			readonly kind: 'scrub';
			readonly from: ViewportTarget;
			readonly to: ViewportTarget;
			readonly progress: number;
			readonly options?: ScrubOptions;
	  }
	| {
			readonly kind: 'scrubTrack';
			readonly stops: readonly ViewportTrackStop[];
			readonly progress: number;
			readonly options?: ScrubOptions;
	  };

/** A `goTo` promise that hasn't settled: either waiting for the viewer to be ready, or animating. */
interface PendingTransition {
	readonly resolve: (result: TransitionResult) => void;
	readonly detachSignal: () => void;
}

interface ActiveAnimation extends PendingTransition {
	frameId: number | undefined;
}

interface QueuedGoTo extends PendingTransition {
	readonly target: ViewportTarget;
}

const TRANSITION_DEFAULTS = {
	duration: DEFAULT_DURATION_MS,
	curve: 'direct' as TransitionCurve,
	easing: easeOutCubic,
	respectReducedMotion: true,
	pauseLoading: true,
	holdResolution: true,
	precache: true
};

function isContainerReady(size: Size): boolean {
	return size.width > 0 && size.height > 0;
}

function formatViewportKey(viewport: Viewport): string {
	return `${viewport.x.toFixed(2)},${viewport.y.toFixed(2)},${viewport.zoom.toFixed(6)}`;
}

function makeBoundsTarget(
	mode: 'fit' | 'fill',
	bounds?: Rect,
	options?: ViewportFitOptions
): ViewportTarget {
	if (!bounds && options?.padding === undefined) {
		return mode;
	}
	return { mode, ...pickDefined<BoundsTarget>({ bounds, padding: options?.padding }) };
}

function cancelledResult(viewer: DziViewerMethods | undefined): TransitionResult {
	return {
		completed: false,
		cancelled: true,
		viewport: viewer?.getViewport() ?? FALLBACK_VIEWPORT
	};
}

function completedResult(viewer: DziViewerMethods): TransitionResult {
	return { completed: true, cancelled: false, viewport: viewer.getViewport() };
}

/** The viewer's image bounds and container size, or `null` until both are known. */
function getFrame(
	viewer: DziViewerMethods
): { readonly imageBounds: Rect; readonly containerSize: Size } | null {
	const imageBounds = viewer.getImageBounds();
	const containerSize = viewer.getContainerSize();
	return imageBounds && isContainerReady(containerSize) ? { imageBounds, containerSize } : null;
}

/**
 * Creates a camera controller that manages animated viewport transitions, scroll-driven scrubbing,
 * resolution/loading holds, destination precaching, and resize refitting for a `DziViewer` or `PanZoom`.
 *
 * Works identically with Svelte `bind:this` references (pass a getter `() => viewer`) and vanilla controllers.
 */
export function createCamera(
	viewerInput: ViewerInput,
	cameraOptions: CameraOptions = {}
): DziCamera {
	nextCameraId += 1;
	// Unique per camera so its loading pause never cancels another caller's pause.
	const pauseReason = `camera-${nextCameraId}`;

	let attachedViewer: DziViewerMethods | undefined;
	let unsubscribe: (() => void) | undefined;
	let destroyed = false;

	let isTransitioning = false;
	let isLoadingPausedByCamera = false;
	let isResolutionHeldByCamera = false;

	let activeAnimation: ActiveAnimation | null = null;
	let queuedGoTo: QueuedGoTo | null = null;
	let precacheController: AbortController | undefined;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;
	let lastPrecacheKey = '';
	let lastState: LastCameraState | null = null;

	const shouldRefitOnResize = (): boolean =>
		typeof cameraOptions.refitOnResize === 'function'
			? cameraOptions.refitOnResize()
			: Boolean(cameraOptions.refitOnResize);

	function setTransitioning(next: boolean): void {
		if (isTransitioning === next) {
			return;
		}
		isTransitioning = next;
		cameraOptions.onTransitionChange?.(next);
	}

	// --- Loading pause and resolution hold ---

	function applyHolds(viewer: DziViewerMethods, wantPause: boolean, wantHold: boolean): void {
		if (wantPause !== isLoadingPausedByCamera) {
			isLoadingPausedByCamera = wantPause;
			if (wantPause) {
				viewer.pauseLoading(pauseReason);
			} else {
				viewer.resumeLoading(pauseReason);
			}
		}
		if (wantHold !== isResolutionHeldByCamera) {
			isResolutionHeldByCamera = wantHold;
			if (wantHold) {
				viewer.holdResolution();
			} else {
				viewer.releaseResolution();
			}
		}
	}

	function releaseHolds(viewer: DziViewerMethods | undefined = attachedViewer): void {
		if (isResolutionHeldByCamera) {
			isResolutionHeldByCamera = false;
			viewer?.releaseResolution();
		}
		if (isLoadingPausedByCamera) {
			isLoadingPausedByCamera = false;
			viewer?.resumeLoading(pauseReason);
		}
	}

	function abortPrecache(): void {
		precacheController?.abort();
		precacheController = undefined;
	}

	function startPrecache(viewer: DziViewerMethods, viewports: readonly Viewport[]): void {
		const controller = new AbortController();
		precacheController = controller;
		viewports.forEach((viewport) => {
			void viewer.precacheViewport(viewport, { signal: controller.signal });
		});
	}

	function clearSettleTimer(): void {
		clearTimeout(settleTimer);
		settleTimer = undefined;
	}

	// --- Stopping work ---

	function cancelQueuedGoTo(viewer: DziViewerMethods | undefined = attachedViewer): void {
		const current = queuedGoTo;
		queuedGoTo = null;
		current?.detachSignal();
		current?.resolve(cancelledResult(viewer));
	}

	/** Stops any animation, settle timer and precache; `releaseViewerHolds: false` keeps holds for a redirect. */
	function stopActiveAnimation(
		releaseViewerHolds: boolean,
		viewer: DziViewerMethods | undefined = attachedViewer
	): void {
		const current = activeAnimation;
		activeAnimation = null;
		if (current?.frameId !== undefined && typeof cancelAnimationFrame === 'function') {
			cancelAnimationFrame(current.frameId);
		}
		current?.detachSignal();
		current?.resolve(cancelledResult(viewer));

		clearSettleTimer();
		abortPrecache();

		if (releaseViewerHolds) {
			releaseHolds(viewer);
			setTransitioning(false);
		}
	}

	function cancel(): void {
		cancelQueuedGoTo(attachedViewer);
		stopActiveAnimation(true, attachedViewer);
	}

	// --- Viewer lifecycle ---

	/** Snaps a queued `goTo` once the viewer has a DZI and a container size. Returns true if it ran. */
	function flushQueuedGoTo(viewer: DziViewerMethods): boolean {
		const frame = getFrame(viewer);
		if (!queuedGoTo || !frame) {
			return false;
		}
		const current = queuedGoTo;
		queuedGoTo = null;
		current.detachSignal();
		lastState = { kind: 'goTo', target: current.target };
		viewer.setViewport(
			resolveViewportTarget(current.target, frame.imageBounds, frame.containerSize)
		);
		current.resolve(completedResult(viewer));
		return true;
	}

	/** Re-frames the last non-explicit target or scrub position for the new container size. */
	function handleResizeRefit(viewer: DziViewerMethods): void {
		const frame = getFrame(viewer);
		if (!shouldRefitOnResize() || isTransitioning || !lastState || !frame) {
			return;
		}
		const { imageBounds, containerSize } = frame;

		if (lastState.kind === 'goTo') {
			if (!isViewportTargetExplicit(lastState.target)) {
				viewer.setViewport(resolveViewportTarget(lastState.target, imageBounds, containerSize));
			}
			return;
		}

		const interpolation = {
			curve: lastState.options?.curve ?? cameraOptions.curve,
			easing: lastState.options?.easing,
			rho: lastState.options?.rho ?? cameraOptions.rho,
			containerSize
		};
		const next =
			lastState.kind === 'scrub'
				? interpolateTarget(
						lastState.from,
						lastState.to,
						imageBounds,
						containerSize,
						lastState.progress,
						interpolation
					)
				: sampleViewportTrack(
						lastState.stops,
						lastState.progress,
						imageBounds,
						containerSize,
						interpolation
					);
		if (next) {
			viewer.setViewport(next);
		}
	}

	function forgetLastState(): void {
		cancel();
		lastState = null;
		lastPrecacheKey = '';
	}

	function handleLifecycle(event: ViewerLifecycleEvent): void {
		const viewer = attachedViewer;
		if (!viewer) {
			return;
		}
		switch (event.type) {
			case 'load':
				flushQueuedGoTo(viewer);
				return;
			case 'resize':
				if (!flushQueuedGoTo(viewer)) {
					handleResizeRefit(viewer);
				}
				return;
			case 'interact':
				// The user took over, so stop animating and don't refit their view on resize.
				cancel();
				lastState = null;
				return;
			case 'source-change':
				forgetLastState();
				return;
			case 'destroy':
				forgetLastState();
				unsubscribe = undefined;
				attachedViewer = undefined;
				return;
		}
	}

	/** Returns the current viewer, re-subscribing if a Svelte `bind:this` reference has changed. */
	function ensureAttached(): DziViewerMethods | undefined {
		if (destroyed) {
			return undefined;
		}
		const current = typeof viewerInput === 'function' ? viewerInput() : viewerInput;
		if (current === attachedViewer) {
			return current;
		}

		if (attachedViewer) {
			cancelQueuedGoTo(attachedViewer);
			stopActiveAnimation(true, attachedViewer);
			unsubscribe?.();
			unsubscribe = undefined;
			attachedViewer = undefined;
			lastPrecacheKey = '';
		}
		if (!current) {
			return undefined;
		}
		attachedViewer = current;
		unsubscribe = current.subscribe(handleLifecycle);
		return current;
	}

	// --- goTo ---

	/** Holds a non-explicit `goTo` until the viewer has a DZI and container size (see `flushQueuedGoTo`). */
	function queueGoTo(
		viewer: DziViewerMethods,
		target: ViewportTarget,
		signal?: AbortSignal
	): Promise<TransitionResult> {
		cancelQueuedGoTo(viewer);
		stopActiveAnimation(true, viewer);
		const { promise, resolve } = Promise.withResolvers<TransitionResult>();
		const detachSignal = onAbort(signal, () => {
			if (queuedGoTo?.resolve === resolve) {
				cancelQueuedGoTo(viewer);
			}
		});
		queuedGoTo = { target, resolve, detachSignal };
		return promise;
	}

	function runAnimation(
		viewer: DziViewerMethods,
		from: Viewport,
		to: Viewport,
		settings: typeof TRANSITION_DEFAULTS & TransitionOptions
	): Promise<TransitionResult> {
		const { promise, resolve } = Promise.withResolvers<TransitionResult>();
		const shouldRender = createFrameLimiter(settings.maxFps);
		const startTime = nowMs();

		const animation: ActiveAnimation = {
			frameId: undefined,
			resolve,
			detachSignal: onAbort(settings.signal, () => {
				if (activeAnimation === animation) {
					stopActiveAnimation(true, viewer);
				}
			})
		};
		activeAnimation = animation;

		const step = (frameTime: number) => {
			if (activeAnimation !== animation) {
				return;
			}
			const progress = Math.min(1, Math.max(0, frameTime - startTime) / settings.duration);
			// Always draw the last frame so the camera lands exactly on `to`.
			if (progress < 1 && !shouldRender(frameTime)) {
				animation.frameId = requestAnimationFrame(step);
				return;
			}

			viewer.setViewport(
				interpolateViewport(from, to, progress, {
					curve: settings.curve,
					easing: settings.easing,
					containerSize: viewer.getContainerSize(),
					rho: settings.rho
				})
			);

			if (progress < 1) {
				animation.frameId = requestAnimationFrame(step);
				return;
			}

			activeAnimation = null;
			animation.detachSignal();
			// Let the destination precache keep warming tiles; just forget its controller.
			precacheController = undefined;
			releaseHolds(viewer);
			setTransitioning(false);
			resolve(completedResult(viewer));
		};

		animation.frameId = requestAnimationFrame(step);
		return promise;
	}

	function goTo(target: ViewportTarget, options?: TransitionOptions): Promise<TransitionResult> {
		const viewer = ensureAttached();
		if (!viewer || options?.signal?.aborted) {
			return Promise.resolve(cancelledResult(viewer));
		}

		const frame = getFrame(viewer);
		const to = isViewportTargetExplicit(target)
			? target
			: frame && resolveViewportTarget(target, frame.imageBounds, frame.containerSize);
		if (!to) {
			return queueGoTo(viewer, target, options?.signal);
		}

		const settings = {
			...TRANSITION_DEFAULTS,
			...pickDefined(cameraOptions),
			...pickDefined(options)
		};
		const duration =
			settings.respectReducedMotion && prefersReducedMotion() ? 0 : Math.max(0, settings.duration);
		const from = viewer.getViewport();
		lastState = { kind: 'goTo', target };
		cancelQueuedGoTo(viewer);

		if (duration <= 0 || viewportsEqual(from, to) || typeof requestAnimationFrame !== 'function') {
			stopActiveAnimation(true, viewer);
			viewer.setViewport(to);
			return Promise.resolve(completedResult(viewer));
		}

		// Keep any active holds across a mid-flight redirect so intermediate frames don't flash tiles.
		stopActiveAnimation(false, viewer);
		applyHolds(viewer, settings.pauseLoading, settings.holdResolution);
		setTransitioning(true);
		if (settings.precache) {
			startPrecache(viewer, [to]);
		}
		return runAnimation(viewer, from, to, { ...settings, duration });
	}

	function fitBounds(
		bounds?: Rect,
		options?: TransitionOptions & ViewportFitOptions
	): Promise<TransitionResult> {
		return goTo(makeBoundsTarget('fit', bounds, options), options);
	}

	function fillBounds(
		bounds?: Rect,
		options?: TransitionOptions & ViewportFitOptions
	): Promise<TransitionResult> {
		return goTo(makeBoundsTarget('fill', bounds, options), options);
	}

	// --- Scrubbing ---

	/** Holds loading and resolution while scrub calls keep coming, releasing them `settleDelayMs` after the last. */
	function scheduleScrubSettle(viewer: DziViewerMethods, options?: ScrubOptions): void {
		const wantPause = options?.pauseLoading ?? cameraOptions.pauseLoading ?? true;
		const wantHold = options?.holdResolution ?? cameraOptions.holdResolution ?? true;
		const settleDelay = Math.max(
			0,
			options?.settleDelayMs ?? cameraOptions.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS
		);

		clearSettleTimer();
		if (!wantPause && !wantHold) {
			return;
		}
		applyHolds(viewer, wantPause, wantHold);
		setTransitioning(true);
		settleTimer = setTimeout(() => {
			settleTimer = undefined;
			releaseHolds(viewer);
			setTransitioning(false);
		}, settleDelay);
	}

	/** Precaches the segment's endpoints once per segment rather than on every scrub call. */
	function triggerScrubPrecache(
		viewer: DziViewerMethods,
		from: Viewport,
		to: Viewport,
		options?: ScrubOptions
	): void {
		const mode = options?.precache ?? (cameraOptions.precache === false ? false : 'to');
		if (!mode) {
			return;
		}
		const key =
			mode === 'both'
				? `both:${formatViewportKey(from)}->${formatViewportKey(to)}`
				: `to:${formatViewportKey(to)}`;
		if (key === lastPrecacheKey) {
			return;
		}
		abortPrecache();
		lastPrecacheKey = key;
		startPrecache(viewer, mode === 'both' ? [to, from] : [to]);
	}

	function applyScrubSegment(
		viewer: DziViewerMethods,
		from: ViewportTarget,
		to: ViewportTarget,
		progress: number,
		curve: TransitionCurve | undefined,
		easing: EasingFunction | undefined,
		options?: ScrubOptions
	): Viewport | null {
		const frame = getFrame(viewer);
		const resolve = (target: ViewportTarget): Viewport | null => {
			if (isViewportTargetExplicit(target)) {
				return target;
			}
			return frame ? resolveViewportTarget(target, frame.imageBounds, frame.containerSize) : null;
		};
		const resolvedFrom = resolve(from);
		const resolvedTo = resolve(to);
		if (!resolvedFrom || !resolvedTo) {
			return null;
		}

		cancelQueuedGoTo(viewer);
		if (activeAnimation) {
			stopActiveAnimation(false, viewer);
		}

		const next = interpolateViewport(resolvedFrom, resolvedTo, progress, {
			curve: curve ?? cameraOptions.curve,
			easing,
			rho: options?.rho ?? cameraOptions.rho,
			containerSize: viewer.getContainerSize()
		});
		viewer.setViewport(next);
		scheduleScrubSettle(viewer, options);
		triggerScrubPrecache(viewer, resolvedFrom, resolvedTo, options);
		return next;
	}

	function scrub(
		from: ViewportTarget,
		to: ViewportTarget,
		progress: number,
		options?: ScrubOptions
	): Viewport | null {
		const viewer = ensureAttached();
		const next =
			viewer &&
			applyScrubSegment(viewer, from, to, progress, options?.curve, options?.easing, options);
		if (next) {
			lastState = { kind: 'scrub', from, to, progress, options };
		}
		return next ?? null;
	}

	function scrubTrack(
		stops: readonly ViewportTrackStop[],
		progress: number,
		options?: ScrubOptions
	): Viewport | null {
		const viewer = ensureAttached();
		const segment = findTrackSegment(stops, progress);
		const next =
			viewer &&
			segment &&
			applyScrubSegment(
				viewer,
				segment.fromStop.target,
				segment.toStop.target,
				segment.localProgress,
				segment.toStop.curve ?? options?.curve,
				segment.toStop.easing ?? options?.easing,
				options
			);
		if (next) {
			lastState = { kind: 'scrubTrack', stops, progress, options };
		}
		return next ?? null;
	}

	function destroy(): void {
		if (destroyed) {
			return;
		}
		forgetLastState();
		destroyed = true;
		unsubscribe?.();
		unsubscribe = undefined;
		attachedViewer = undefined;
	}

	// Attach immediately if a live viewer reference was passed in directly.
	ensureAttached();

	return {
		get isTransitioning() {
			return isTransitioning;
		},
		goTo,
		fitBounds,
		fillBounds,
		scrub,
		scrubTrack,
		cancel,
		destroy
	};
}
