<script lang="ts">
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
	import { clampViewport } from '../../viewport.js';
	import OpenSeahorse from '../OpenSeahorse/OpenSeahorse.svelte';
	import type { OpenSeahorseMethods } from '../OpenSeahorse/openSeahorseTypes.js';
	import type { PanZoomProps } from './panZoomTypes.js';
	import {
		computePinchStep,
		computeWheelZoomMultiplier,
		panByScreenDelta,
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
		onInteract,
		...seahorseProps
	}: PanZoomProps = $props();

	let rootEl: HTMLDivElement | undefined = $state();
	let viewer: OpenSeahorseMethods | undefined = $state();
	let isDragging = $state(false);

	// Pointer positions are gesture bookkeeping read only inside event handlers, so they need no reactivity.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const activePointers = new Map<number, Point>();
	let lastAppliedViewport: Viewport = { x: Number.NaN, y: Number.NaN, zoom: Number.NaN };

	const interactive = $derived(!disabled && (panEnabled || zoomEnabled));
	const canPan = $derived(!disabled && panEnabled);
	const canZoom = $derived(!disabled && zoomEnabled);

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
	 * The viewport as currently drawn. `OpenSeahorse` renders `x/y/zoom` clamped by `constraints`, so gestures
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
		onInteract?.(next);
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

		if (canPan) {
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
			if (!canPan) {
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
		return viewer?.stageToScreen(point) ?? point;
	}

	export function screenToStage(point: Point): Point {
		return viewer?.screenToStage(point) ?? point;
	}

	export function pauseLoading(): void {
		viewer?.pauseLoading();
	}

	export function resumeLoading(): void {
		viewer?.resumeLoading();
	}

	export function isLoadingPaused(): boolean {
		return viewer?.isLoadingPaused() ?? false;
	}
</script>

<!--
	`role="application"` marks an interactive widget that handles its own keyboard and pointer input,
	but Svelte's a11y rules don't count it as interactive, so they would flag the tabindex and handlers.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	bind:this={rootEl}
	class="osh-panzoom {className}"
	class:osh-panzoom-interactive={interactive}
	class:osh-panzoom-pannable={canPan}
	class:osh-panzoom-dragging={isDragging}
	role="application"
	aria-label={seahorseProps.alt || 'Interactive deep zoom image viewer'}
	aria-disabled={disabled ? 'true' : undefined}
	tabindex={keyboardEnabled && interactive ? 0 : undefined}
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerRelease}
	onpointercancel={handlePointerRelease}
	ondblclick={handleDoubleClick}
	onkeydown={handleKeyDown}
>
	<OpenSeahorse
		bind:this={viewer}
		bind:x
		bind:y
		bind:zoom
		bind:containerSize
		bind:dzi
		bind:isOptimalLoaded
		{constraints}
		{...seahorseProps}
	/>
</div>

<style>
	.osh-panzoom {
		position: relative;
		width: 100%;
		height: 100%;
		user-select: none;
		-webkit-user-select: none;
	}

	.osh-panzoom-interactive {
		touch-action: none;
	}

	.osh-panzoom-pannable {
		cursor: grab;
	}

	.osh-panzoom-dragging {
		cursor: grabbing;
	}

	.osh-panzoom:focus-visible {
		outline: 2px solid #3b82f6;
		outline-offset: -2px;
	}
</style>
