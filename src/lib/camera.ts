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

interface ActiveAnimation {
	frameId: number | undefined;
	readonly resolve: (result: TransitionResult) => void;
	readonly cleanupSignal?: () => void;
}

interface PendingGoTo {
	readonly target: ViewportTarget;
	readonly resolve: (result: TransitionResult) => void;
	readonly cleanupSignal?: () => void;
}

function nowMs(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function prefersReducedMotion(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}

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
	const target: BoundsTarget = {
		mode,
		...(bounds ? { bounds } : {}),
		...(options?.padding !== undefined ? { padding: options.padding } : {})
	};
	return target;
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
	const pauseReason = `camera-${nextCameraId}`;

	let attachedViewer: DziViewerMethods | undefined;
	let unsubscribe: (() => void) | undefined;
	let destroyed = false;

	let isTransitioning = false;
	let isLoadingPausedByCamera = false;
	let isResolutionHeldByCamera = false;

	let activeAnimation: ActiveAnimation | null = null;
	let pendingGoTo: PendingGoTo | null = null;
	let precacheController: AbortController | undefined;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;
	let lastPrecacheKey = '';
	let lastState: LastCameraState | null = null;

	const resolveViewer = (): DziViewerMethods | undefined =>
		typeof viewerInput === 'function' ? viewerInput() : viewerInput;

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

	function applyHolds(
		viewer: DziViewerMethods,
		wantPause: boolean,
		wantHoldResolution: boolean
	): void {
		if (wantPause && !isLoadingPausedByCamera) {
			viewer.pauseLoading(pauseReason);
			isLoadingPausedByCamera = true;
		} else if (!wantPause && isLoadingPausedByCamera) {
			viewer.resumeLoading(pauseReason);
			isLoadingPausedByCamera = false;
		}

		if (wantHoldResolution && !isResolutionHeldByCamera) {
			viewer.holdResolution();
			isResolutionHeldByCamera = true;
		} else if (!wantHoldResolution && isResolutionHeldByCamera) {
			viewer.releaseResolution();
			isResolutionHeldByCamera = false;
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
		if (!precacheController) {
			return;
		}
		precacheController.abort();
		precacheController = undefined;
	}

	function clearSettleTimer(): void {
		if (settleTimer === undefined) {
			return;
		}
		clearTimeout(settleTimer);
		settleTimer = undefined;
	}

	function cancelPendingGoTo(viewer: DziViewerMethods | undefined = attachedViewer): void {
		if (!pendingGoTo) {
			return;
		}
		const current = pendingGoTo;
		pendingGoTo = null;
		current.cleanupSignal?.();
		current.resolve({
			completed: false,
			cancelled: true,
			viewport: viewer?.getViewport() ?? FALLBACK_VIEWPORT
		});
	}

	function stopActiveAnimation(
		releaseViewerHolds: boolean,
		viewer: DziViewerMethods | undefined = attachedViewer
	): void {
		if (activeAnimation) {
			const current = activeAnimation;
			activeAnimation = null;
			if (current.frameId !== undefined && typeof cancelAnimationFrame === 'function') {
				cancelAnimationFrame(current.frameId);
			}
			current.cleanupSignal?.();
			current.resolve({
				completed: false,
				cancelled: true,
				viewport: viewer?.getViewport() ?? FALLBACK_VIEWPORT
			});
		}

		clearSettleTimer();
		abortPrecache();

		if (releaseViewerHolds) {
			releaseHolds(viewer);
			setTransitioning(false);
		}
	}

	function flushPendingGoTo(viewer: DziViewerMethods): boolean {
		if (!pendingGoTo) {
			return false;
		}
		const imageBounds = viewer.getImageBounds();
		const containerSize = viewer.getContainerSize();
		if (!imageBounds || !isContainerReady(containerSize)) {
			return false;
		}

		const current = pendingGoTo;
		pendingGoTo = null;
		current.cleanupSignal?.();

		const resolved = resolveViewportTarget(current.target, imageBounds, containerSize);
		lastState = { kind: 'goTo', target: current.target };
		viewer.setViewport(resolved);
		current.resolve({
			completed: true,
			cancelled: false,
			viewport: viewer.getViewport()
		});
		return true;
	}

	function handleResizeRefit(viewer: DziViewerMethods): void {
		if (!shouldRefitOnResize() || isTransitioning || !lastState) {
			return;
		}
		const imageBounds = viewer.getImageBounds();
		const containerSize = viewer.getContainerSize();
		if (!imageBounds || !isContainerReady(containerSize)) {
			return;
		}

		if (lastState.kind === 'goTo') {
			if (isViewportTargetExplicit(lastState.target)) {
				return;
			}
			viewer.setViewport(resolveViewportTarget(lastState.target, imageBounds, containerSize));
			return;
		}

		if (lastState.kind === 'scrub') {
			const next = interpolateTarget(
				lastState.from,
				lastState.to,
				imageBounds,
				containerSize,
				lastState.progress,
				{
					curve: lastState.options?.curve ?? cameraOptions.curve,
					easing: lastState.options?.easing,
					rho: lastState.options?.rho ?? cameraOptions.rho,
					containerSize
				}
			);
			viewer.setViewport(next);
			return;
		}

		const next = sampleViewportTrack(
			lastState.stops,
			lastState.progress,
			imageBounds,
			containerSize,
			{
				curve: lastState.options?.curve ?? cameraOptions.curve,
				easing: lastState.options?.easing,
				rho: lastState.options?.rho ?? cameraOptions.rho,
				containerSize
			}
		);
		if (next) {
			viewer.setViewport(next);
		}
	}

	function handleLifecycle(event: ViewerLifecycleEvent): void {
		const viewer = attachedViewer;
		if (!viewer) {
			return;
		}

		if (event.type === 'load') {
			flushPendingGoTo(viewer);
			return;
		}

		if (event.type === 'resize') {
			if (!flushPendingGoTo(viewer)) {
				handleResizeRefit(viewer);
			}
			return;
		}

		if (event.type === 'interact') {
			cancel();
			lastState = null;
			return;
		}

		if (event.type === 'source-change') {
			cancel();
			lastState = null;
			lastPrecacheKey = '';
			return;
		}

		if (event.type === 'destroy') {
			cancel();
			lastState = null;
			lastPrecacheKey = '';
			unsubscribe = undefined;
			attachedViewer = undefined;
		}
	}

	function ensureAttached(): DziViewerMethods | undefined {
		if (destroyed) {
			return undefined;
		}

		const current = resolveViewer();
		if (current === attachedViewer) {
			return current;
		}

		if (attachedViewer) {
			cancelPendingGoTo(attachedViewer);
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

	function scheduleScrubSettle(viewer: DziViewerMethods, options?: ScrubOptions): void {
		const wantPause = options?.pauseLoading ?? cameraOptions.pauseLoading ?? true;
		const wantHold = options?.holdResolution ?? cameraOptions.holdResolution ?? true;
		const settleDelay = Math.max(
			0,
			options?.settleDelayMs ?? cameraOptions.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS
		);

		if (!wantPause && !wantHold) {
			clearSettleTimer();
			return;
		}

		applyHolds(viewer, wantPause, wantHold);
		setTransitioning(true);
		clearSettleTimer();

		settleTimer = setTimeout(() => {
			settleTimer = undefined;
			releaseHolds(viewer);
			setTransitioning(false);
		}, settleDelay);
	}

	function triggerScrubPrecache(
		viewer: DziViewerMethods,
		resolvedFrom: Viewport,
		resolvedTo: Viewport,
		options?: ScrubOptions
	): void {
		const defaultMode: ScrubPrecacheMode = cameraOptions.precache === false ? false : 'to';
		const mode = options?.precache ?? defaultMode;
		if (!mode) {
			return;
		}

		const key =
			mode === 'both'
				? `both:${formatViewportKey(resolvedFrom)}->${formatViewportKey(resolvedTo)}`
				: `to:${formatViewportKey(resolvedTo)}`;

		if (key === lastPrecacheKey) {
			return;
		}

		abortPrecache();
		lastPrecacheKey = key;

		const controller = new AbortController();
		precacheController = controller;
		void viewer.precacheViewport(resolvedTo, { signal: controller.signal });
		if (mode === 'both') {
			void viewer.precacheViewport(resolvedFrom, { signal: controller.signal });
		}
	}

	function goTo(target: ViewportTarget, options?: TransitionOptions): Promise<TransitionResult> {
		const viewer = ensureAttached();
		if (!viewer) {
			return Promise.resolve({
				completed: false,
				cancelled: true,
				viewport: FALLBACK_VIEWPORT
			});
		}

		if (options?.signal?.aborted) {
			return Promise.resolve({
				completed: false,
				cancelled: true,
				viewport: viewer.getViewport()
			});
		}

		const imageBounds = viewer.getImageBounds();
		const containerSize = viewer.getContainerSize();

		let to: Viewport;
		if (isViewportTargetExplicit(target)) {
			to = target;
		} else if (!imageBounds || !isContainerReady(containerSize)) {
			cancelPendingGoTo(viewer);
			stopActiveAnimation(true, viewer);

			return new Promise((resolve) => {
				const handleAbort = () => {
					if (pendingGoTo?.resolve === resolve) {
						cancelPendingGoTo(viewer);
					}
				};
				options?.signal?.addEventListener('abort', handleAbort, { once: true });

				pendingGoTo = {
					target,
					resolve,
					cleanupSignal: options?.signal
						? () => options.signal?.removeEventListener('abort', handleAbort)
						: undefined
				};
			});
		} else {
			to = resolveViewportTarget(target, imageBounds, containerSize);
		}

		const respectReduced =
			options?.respectReducedMotion ?? cameraOptions.respectReducedMotion ?? true;
		const requestedDuration = options?.duration ?? cameraOptions.duration ?? DEFAULT_DURATION_MS;
		const effectiveDuration =
			respectReduced && prefersReducedMotion() ? 0 : Math.max(0, requestedDuration);

		const from = viewer.getViewport();
		lastState = { kind: 'goTo', target };
		cancelPendingGoTo(viewer);

		if (
			effectiveDuration <= 0 ||
			viewportsEqual(from, to) ||
			typeof requestAnimationFrame !== 'function'
		) {
			stopActiveAnimation(true, viewer);
			viewer.setViewport(to);
			return Promise.resolve({
				completed: true,
				cancelled: false,
				viewport: viewer.getViewport()
			});
		}

		// Keep any active holds across mid-flight redirection so intermediate frames don't flash tiles.
		stopActiveAnimation(false, viewer);

		const wantPause = options?.pauseLoading ?? cameraOptions.pauseLoading ?? true;
		const wantHold = options?.holdResolution ?? cameraOptions.holdResolution ?? true;
		const wantPrecache = options?.precache ?? cameraOptions.precache ?? true;
		const curve = options?.curve ?? cameraOptions.curve ?? 'direct';
		const easing = options?.easing ?? cameraOptions.easing ?? easeOutCubic;
		const rho = options?.rho ?? cameraOptions.rho;
		const maxFps = options?.maxFps ?? cameraOptions.maxFps;
		const frameIntervalMs =
			maxFps !== undefined && Number.isFinite(maxFps) && maxFps > 0 ? 1000 / maxFps : 0;
		// Allow a small timing tolerance so minor rAF jitter on 60Hz/120Hz displays doesn't drop a 30fps cap to 20fps.
		const minFrameIntervalMs =
			frameIntervalMs > 0 ? frameIntervalMs - Math.min(2, frameIntervalMs * 0.1) : 0;

		applyHolds(viewer, wantPause, wantHold);
		setTransitioning(true);

		if (wantPrecache) {
			const controller = new AbortController();
			precacheController = controller;
			void viewer.precacheViewport(to, { signal: controller.signal });
		}

		return new Promise((resolve) => {
			const handleAbort = () => {
				if (activeAnimation?.resolve === resolve) {
					stopActiveAnimation(true, viewer);
				}
			};
			options?.signal?.addEventListener('abort', handleAbort, { once: true });

			const animation: ActiveAnimation = {
				frameId: undefined,
				resolve,
				cleanupSignal: options?.signal
					? () => options.signal?.removeEventListener('abort', handleAbort)
					: undefined
			};
			activeAnimation = animation;

			const startTime = nowMs();
			let lastRenderTime = Number.NEGATIVE_INFINITY;

			const step = (frameTime: number) => {
				if (activeAnimation !== animation) {
					return;
				}

				const elapsed = Math.max(0, frameTime - startTime);
				const rawProgress = Math.min(1, elapsed / effectiveDuration);

				if (rawProgress < 1 && minFrameIntervalMs > 0 && frameTime - lastRenderTime < minFrameIntervalMs) {
					animation.frameId = requestAnimationFrame(step);
					return;
				}
				lastRenderTime = frameTime;

				const next = interpolateViewport(from, to, rawProgress, {
					curve,
					easing,
					containerSize: viewer.getContainerSize(),
					rho
				});

				viewer.setViewport(next);

				if (rawProgress < 1) {
					animation.frameId = requestAnimationFrame(step);
					return;
				}

				activeAnimation = null;
				animation.cleanupSignal?.();
				// Leave the destination precache running to finish warming tiles; just detach the controller reference.
				precacheController = undefined;
				releaseHolds(viewer);
				setTransitioning(false);
				resolve({
					completed: true,
					cancelled: false,
					viewport: viewer.getViewport()
				});
			};

			animation.frameId = requestAnimationFrame(step);
		});
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

	function applyScrubSegment(
		viewer: DziViewerMethods,
		from: ViewportTarget,
		to: ViewportTarget,
		progress: number,
		curve: TransitionCurve | undefined,
		easing: EasingFunction | undefined,
		options?: ScrubOptions
	): Viewport | null {
		const imageBounds = viewer.getImageBounds();
		const containerSize = viewer.getContainerSize();
		const readyBounds = imageBounds && isContainerReady(containerSize) ? imageBounds : null;

		const resolvedFrom = isViewportTargetExplicit(from)
			? from
			: readyBounds
				? resolveViewportTarget(from, readyBounds, containerSize)
				: null;
		const resolvedTo = isViewportTargetExplicit(to)
			? to
			: readyBounds
				? resolveViewportTarget(to, readyBounds, containerSize)
				: null;

		if (!resolvedFrom || !resolvedTo) {
			return null;
		}

		cancelPendingGoTo(viewer);
		if (activeAnimation) {
			stopActiveAnimation(false, viewer);
		}

		const next = interpolateViewport(resolvedFrom, resolvedTo, progress, {
			curve: curve ?? cameraOptions.curve,
			easing,
			rho: options?.rho ?? cameraOptions.rho,
			containerSize
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
		if (!viewer) {
			return null;
		}

		const next = applyScrubSegment(
			viewer,
			from,
			to,
			progress,
			options?.curve,
			options?.easing,
			options
		);
		if (next) {
			lastState = { kind: 'scrub', from, to, progress, options };
		}
		return next;
	}

	function scrubTrack(
		stops: readonly ViewportTrackStop[],
		progress: number,
		options?: ScrubOptions
	): Viewport | null {
		const viewer = ensureAttached();
		if (!viewer) {
			return null;
		}

		const segment = findTrackSegment(stops, progress);
		if (!segment) {
			return null;
		}

		const next = applyScrubSegment(
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
		return next;
	}

	function cancel(): void {
		cancelPendingGoTo(attachedViewer);
		stopActiveAnimation(true, attachedViewer);
	}

	function destroy(): void {
		if (destroyed) {
			return;
		}
		cancel();
		destroyed = true;
		lastState = null;
		lastPrecacheKey = '';
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
