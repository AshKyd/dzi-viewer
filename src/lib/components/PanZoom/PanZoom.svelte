<script lang="ts">
	import { untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { EMPTY_PRECACHE_RESULT } from '../../precache.js';
	import type {
		DziDescriptor,
		Point,
		PrecacheOptions,
		PrecacheResult,
		Rect,
		Size,
		Viewport,
		ViewportFitOptions
	} from '../../types.js';
	import {
		clampViewport,
		screenToStage as convertScreenToStage,
		stageToScreen as convertStageToScreen
	} from '../../viewport.js';
	import DziViewer from '../DziViewer/DziViewer.svelte';
	import type { DziViewerMethods, ViewerLifecycleListener } from '../DziViewer/dziViewerTypes.js';
	import { createLifecycleEmitter } from '../../lifecycleEmitter.js';
	import type { PanZoomProps } from './panZoomTypes.js';
	import {
		computePinchStep,
		computeWheelZoomMultiplier,
		DEFAULT_COOPERATIVE_GESTURE_MESSAGES,
		isApplePlatform,
		panByScreenDelta,
		shouldWheelZoom,
		zoomAroundPoint
	} from './panZoomUtils.js';

	let {
		x = $bindable(0),
		y = $bindable(0),
		zoom = $bindable(1),
		containerSize = $bindable<Size>({ width: 0, height: 0 }),
		dzi = $bindable<DziDescriptor | null>(null),
		isOptimalLoaded = $bindable(false),
		constraints,
		class: className = '',
		disabled = false,
		panEnabled = true,
		zoomEnabled = true,
		wheelZoomFactor = 1.2,
		doubleClickZoomFactor = 2,
		keyboardEnabled = true,
		keyboardPanStep = 80,
		keyboardZoomFactor = 1.25,
		cooperativeGestures = false,
		cooperativeGestureMessages,
		loadDebounceMs = 0,
		onInteract,
		...viewerProps
	}: PanZoomProps = $props();

	const DEBOUNCE_PAUSE_REASON = 'panzoom-debounce';

	let rootEl: HTMLDivElement | undefined = $state();
	let viewer: DziViewerMethods | undefined = $state();
	let isDragging = $state(false);
	let loadDebounceTimer: ReturnType<typeof setTimeout> | undefined;

	// Pointer positions are bookkeeping only, so they need no reactivity.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const activePointers = new Map<number, Point>();
	const lifecycle = createLifecycleEmitter();
	let lastAppliedViewport: Viewport = { x: Number.NaN, y: Number.NaN, zoom: Number.NaN };

	function clearLoadDebounce(): void {
		if (loadDebounceTimer === undefined) {
			return;
		}
		clearTimeout(loadDebounceTimer);
		loadDebounceTimer = undefined;
		viewer?.resumeLoading(DEBOUNCE_PAUSE_REASON);
	}

	const interactive = $derived(!disabled && (panEnabled || zoomEnabled));
	const canPan = $derived(!disabled && panEnabled);
	const canZoom = $derived(!disabled && zoomEnabled);

	// --- Cooperative gestures hint ---

	const HINT_DURATION_MS = 1500;
	const hintMessages = $derived({
		...DEFAULT_COOPERATIVE_GESTURE_MESSAGES,
		...cooperativeGestureMessages
	});
	let hintMessage = $state<string | null>(null);
	let hintTimer: ReturnType<typeof setTimeout> | undefined;

	/** Shows `message` over the viewer, hiding it once gestures stop for `HINT_DURATION_MS`. */
	function showHint(message: string): void {
		hintMessage = message;
		clearTimeout(hintTimer);
		hintTimer = setTimeout(() => (hintMessage = null), HINT_DURATION_MS);
	}

	// Forward inner DziViewer lifecycle events (except `destroy`, emitted on PanZoom unmount so it fires once).
	$effect(() => {
		const currentViewer = viewer;
		if (!currentViewer) {
			return;
		}
		return currentViewer.subscribe((event) => {
			if (event.type !== 'destroy') {
				lifecycle.emit(event);
			}
		});
	});

	// If `loadDebounceMs` is disabled mid-debounce, release the debounce pause immediately.
	$effect(() => {
		if (loadDebounceMs <= 0) {
			clearLoadDebounce();
		}
	});

	$effect(() => {
		return () => {
			clearTimeout(hintTimer);
			clearLoadDebounce();
			lifecycle.emit({ type: 'destroy' });
			lifecycle.clear();
		};
	});

	// In cooperative mode the browser scrolls the page for one finger (`touch-action: pan-x pan-y`).
	// Pointer events can't stop that, so a non-passive `touchmove` blocks it once a second finger is down.
	$effect(() => {
		const el = rootEl;
		if (!el || !cooperativeGestures || !interactive) {
			return;
		}

		const handleTouchMove = (event: TouchEvent) => {
			if (event.touches.length === 1) {
				showHint(hintMessages.touch);
				return;
			}
			if (event.cancelable) {
				event.preventDefault();
			}
		};

		el.addEventListener('touchmove', handleTouchMove, { passive: false });
		return () => el.removeEventListener('touchmove', handleTouchMove);
	});

	/** In cooperative mode, a lone touch scrolls the page instead of panning. */
	function isCooperativeSingleTouch(event: PointerEvent): boolean {
		return cooperativeGestures && event.pointerType === 'touch' && activePointers.size === 1;
	}

	// External updates to bound x/y/zoom override any active gesture immediately.
	$effect(() => {
		const externalChanged =
			x !== lastAppliedViewport.x ||
			y !== lastAppliedViewport.y ||
			zoom !== lastAppliedViewport.zoom;

		if (!externalChanged) {
			return;
		}

		if (rootEl) {
			Array.from(activePointers.keys()).forEach((pointerId) => {
				if (rootEl?.hasPointerCapture(pointerId)) {
					rootEl.releasePointerCapture(pointerId);
				}
			});
		}

		activePointers.clear();
		isDragging = false;
		lastAppliedViewport = { x, y, zoom };
	});

	/**
	 * The viewport as currently drawn. `DziViewer` renders `x/y/zoom` clamped by `constraints`, so gestures
	 * must start from the clamped values too, or the first drag jumps when the bound values are out of range.
	 */
	function currentViewport(): Viewport {
		return clampViewport({ x, y, zoom }, constraints, containerSize);
	}

	function commitInteraction(next: Viewport): void {
		if (next.x === x && next.y === y && next.zoom === zoom) {
			return;
		}
		lastAppliedViewport = next;
		x = next.x;
		y = next.y;
		zoom = next.zoom;
		if (loadDebounceMs > 0) {
			viewer?.pauseLoading(DEBOUNCE_PAUSE_REASON);
			clearTimeout(loadDebounceTimer);
			loadDebounceTimer = setTimeout(() => {
				loadDebounceTimer = undefined;
				viewer?.resumeLoading(DEBOUNCE_PAUSE_REASON);
			}, loadDebounceMs);
		}
		onInteract?.(next);
		lifecycle.emit({ type: 'interact', viewport: next });
	}

	/** Pans by a screen-space delta (positive moves the image right/down). */
	function panBy(deltaX: number, deltaY: number): void {
		commitInteraction(
			panByScreenDelta({
				viewport: currentViewport(),
				containerSize,
				deltaX,
				deltaY,
				constraints
			})
		);
	}

	/** Multiplies the zoom by `factor`, keeping the stage point under `focalScreenPoint` still. */
	function zoomBy(factor: number, focalScreenPoint: Point): void {
		const viewport = currentViewport();
		commitInteraction(
			zoomAroundPoint({
				viewport,
				containerSize,
				focalScreenPoint,
				nextZoom: viewport.zoom * factor,
				constraints
			})
		);
	}

	function getLocalPoint(clientX: number, clientY: number): Point {
		const rect = rootEl?.getBoundingClientRect();
		if (!rect) {
			return { x: clientX, y: clientY };
		}
		return {
			x: clientX - rect.left,
			y: clientY - rect.top
		};
	}

	// Register a non-passive wheel listener so preventDefault blocks page scroll while zooming.
	$effect(() => {
		const el = rootEl;
		if (!el) {
			return;
		}

		const handleWheel = (event: WheelEvent) => {
			if (!canZoom) {
				return;
			}
			const { ctrlKey, metaKey } = event;
			if (!shouldWheelZoom({ cooperativeGestures, ctrlKey, metaKey })) {
				// Leave the event alone so the page scrolls.
				showHint(isApplePlatform(navigator.platform) ? hintMessages.wheelMac : hintMessages.wheel);
				return;
			}
			event.preventDefault();

			const multiplier = computeWheelZoomMultiplier({
				deltaY: event.deltaY,
				deltaMode: event.deltaMode,
				ctrlKey: event.ctrlKey,
				wheelZoomFactor
			});
			if (multiplier === 1) {
				return;
			}

			zoomBy(multiplier, getLocalPoint(event.clientX, event.clientY));
		};

		el.addEventListener('wheel', handleWheel, { passive: false });
		return () => el.removeEventListener('wheel', handleWheel);
	});

	function handlePointerDown(event: PointerEvent): void {
		if (!interactive) {
			return;
		}
		if (event.pointerType === 'mouse' && event.button !== 0) {
			return;
		}

		const point = getLocalPoint(event.clientX, event.clientY);
		activePointers.set(event.pointerId, point);
		rootEl?.setPointerCapture(event.pointerId);

		if (canPan && !isCooperativeSingleTouch(event)) {
			isDragging = true;
		}
	}

	function handlePointerMove(event: PointerEvent): void {
		const previous = activePointers.get(event.pointerId);
		if (!previous || !interactive) {
			return;
		}

		const nextPoint = getLocalPoint(event.clientX, event.clientY);

		if (activePointers.size === 1) {
			activePointers.set(event.pointerId, nextPoint);
			if (!canPan || isCooperativeSingleTouch(event)) {
				return;
			}

			panBy(nextPoint.x - previous.x, nextPoint.y - previous.y);
			return;
		}

		const pointerEntries = Array.from(activePointers.entries());
		const [firstId, firstPrev] = pointerEntries[0];
		const [secondId, secondPrev] = pointerEntries[1];
		activePointers.set(event.pointerId, nextPoint);

		if (event.pointerId !== firstId && event.pointerId !== secondId) {
			return;
		}

		const firstNext = activePointers.get(firstId) ?? firstPrev;
		const secondNext = activePointers.get(secondId) ?? secondPrev;

		const next = computePinchStep({
			viewport: currentViewport(),
			containerSize,
			prevA: firstPrev,
			prevB: secondPrev,
			nextA: firstNext,
			nextB: secondNext,
			zoomEnabled: canZoom,
			panEnabled: canPan,
			constraints
		});
		commitInteraction(next);
	}

	function handlePointerRelease(event: PointerEvent): void {
		if (!activePointers.has(event.pointerId)) {
			return;
		}
		activePointers.delete(event.pointerId);
		if (rootEl?.hasPointerCapture(event.pointerId)) {
			rootEl.releasePointerCapture(event.pointerId);
		}
		if (activePointers.size === 0) {
			isDragging = false;
		}
	}

	function handleDoubleClick(event: MouseEvent): void {
		if (!canZoom || doubleClickZoomFactor <= 0 || doubleClickZoomFactor === 1) {
			return;
		}

		const factor = event.shiftKey ? 1 / doubleClickZoomFactor : doubleClickZoomFactor;
		zoomBy(factor, getLocalPoint(event.clientX, event.clientY));
	}

	function handleKeyDown(event: KeyboardEvent): void {
		if (disabled || !keyboardEnabled) {
			return;
		}

		const panMap: Readonly<Record<string, Point>> = {
			ArrowLeft: { x: keyboardPanStep, y: 0 },
			ArrowRight: { x: -keyboardPanStep, y: 0 },
			ArrowUp: { x: 0, y: keyboardPanStep },
			ArrowDown: { x: 0, y: -keyboardPanStep }
		};

		const panDelta = panMap[event.key];
		if (panDelta && canPan) {
			event.preventDefault();
			panBy(panDelta.x, panDelta.y);
			return;
		}

		const isZoomIn = event.key === '+' || event.key === '=';
		const isZoomOut = event.key === '-' || event.key === '_';
		if ((isZoomIn || isZoomOut) && canZoom) {
			event.preventDefault();
			const factor = isZoomIn ? keyboardZoomFactor : 1 / keyboardZoomFactor;
			zoomBy(factor, { x: containerSize.width / 2, y: containerSize.height / 2 });
		}
	}

	export function setViewport(viewport: Partial<Viewport>): void {
		if (viewer) {
			viewer.setViewport(viewport);
			return;
		}
		if (viewport.x !== undefined) {
			x = viewport.x;
		}
		if (viewport.y !== undefined) {
			y = viewport.y;
		}
		if (viewport.zoom !== undefined) {
			zoom = viewport.zoom;
		}
	}

	export function getViewport(): Viewport {
		return viewer?.getViewport() ?? untrack(() => currentViewport());
	}

	export function getImageBounds(): Rect | null {
		return viewer?.getImageBounds() ?? null;
	}

	export function getContainerSize(): Size {
		return viewer?.getContainerSize() ?? untrack(() => containerSize);
	}

	export function subscribe(listener: ViewerLifecycleListener): () => void {
		return lifecycle.subscribe(listener);
	}

	export function getFitViewport(bounds?: Rect, options?: ViewportFitOptions): Viewport | null {
		return viewer?.getFitViewport(bounds, options) ?? null;
	}

	export function getFillViewport(bounds?: Rect, options?: ViewportFitOptions): Viewport | null {
		return viewer?.getFillViewport(bounds, options) ?? null;
	}

	export function precacheViewport(
		targetViewport: Viewport,
		options?: PrecacheOptions
	): Promise<PrecacheResult> {
		return (
			viewer?.precacheViewport(targetViewport, options) ?? Promise.resolve(EMPTY_PRECACHE_RESULT)
		);
	}

	export function precacheBounds(
		bounds: Rect | undefined,
		mode: 'fit' | 'fill',
		options?: PrecacheOptions & ViewportFitOptions
	): Promise<PrecacheResult> {
		return viewer?.precacheBounds(bounds, mode, options) ?? Promise.resolve(EMPTY_PRECACHE_RESULT);
	}

	export function stageToScreen(point: Point): Point {
		return (
			viewer?.stageToScreen(point) ??
			untrack(() => convertStageToScreen(point, currentViewport(), containerSize))
		);
	}

	export function screenToStage(point: Point): Point {
		return (
			viewer?.screenToStage(point) ??
			untrack(() => convertScreenToStage(point, currentViewport(), containerSize))
		);
	}

	export function pauseLoading(reason?: string): void {
		viewer?.pauseLoading(reason);
	}

	export function resumeLoading(reason?: string): void {
		viewer?.resumeLoading(reason);
	}

	export function isLoadingPaused(): boolean {
		return viewer?.isLoadingPaused() ?? false;
	}

	export function holdResolution(): void {
		viewer?.holdResolution();
	}

	export function releaseResolution(): void {
		viewer?.releaseResolution();
	}

	export function isResolutionHeld(): boolean {
		return viewer?.isResolutionHeld() ?? false;
	}
</script>

<!--
	`role="application"` marks an interactive widget that handles its own keyboard and pointer input,
	but Svelte's a11y rules don't count it as interactive, so they would flag the tabindex and handlers.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	bind:this={rootEl}
	class="dzi-panzoom {className}"
	class:dzi-panzoom-interactive={interactive}
	class:dzi-panzoom-pannable={canPan}
	class:dzi-panzoom-dragging={isDragging}
	class:dzi-panzoom-cooperative={cooperativeGestures && interactive}
	role="application"
	aria-label={viewerProps.alt || 'Interactive deep zoom image viewer'}
	aria-disabled={disabled ? 'true' : undefined}
	tabindex={keyboardEnabled && interactive ? 0 : undefined}
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerRelease}
	onpointercancel={handlePointerRelease}
	ondblclick={handleDoubleClick}
	onkeydown={handleKeyDown}
>
	<DziViewer
		bind:this={viewer}
		bind:x
		bind:y
		bind:zoom
		bind:containerSize
		bind:dzi
		bind:isOptimalLoaded
		{constraints}
		{...viewerProps}
	/>
	{#if hintMessage}
		<!-- Pointer-only guidance: keyboard and screen-reader users aren't affected by cooperative mode. -->
		<div class="dzi-panzoom-hint" aria-hidden="true" transition:fade={{ duration: 150 }}>
			{hintMessage}
		</div>
	{/if}
</div>

<style>
	.dzi-panzoom {
		position: relative;
		width: 100%;
		height: 100%;
		user-select: none;
		-webkit-user-select: none;
	}

	.dzi-panzoom-interactive {
		touch-action: none;
	}

	/* After `.dzi-panzoom-interactive` so it wins: one finger scrolls the page, two are handled here. */
	.dzi-panzoom-cooperative {
		touch-action: pan-x pan-y;
	}

	.dzi-panzoom-hint {
		position: absolute;
		inset: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgb(0 0 0 / 0.5);
		color: #fff;
		font:
			500 1rem/1.4 system-ui,
			sans-serif;
		text-align: center;
		pointer-events: none;
	}

	.dzi-panzoom-pannable {
		cursor: grab;
	}

	.dzi-panzoom-dragging {
		cursor: grabbing;
	}

	.dzi-panzoom:focus-visible {
		outline: 2px solid #3b82f6;
		outline-offset: -2px;
	}
</style>
