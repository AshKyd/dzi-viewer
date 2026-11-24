<script lang="ts">
	import { clampDpr, DEFAULT_MAX_DPR, getOptimalLevel } from '../../tiling.js';
	import type { DziDescriptor, Rect, Size, Viewport, ViewportConstraints } from '../../types.js';
	import { resolveStageAndImageBounds } from '../../viewport.js';
	import type { DziViewerMethods } from '../DziViewer/dziViewerTypes.js';
	import PanZoom from './PanZoom.svelte';

	interface Props {
		/** DZI descriptor URL to display. */
		source: string;
		/** Optional virtual stage size. */
		stageSize?: Size;
		/** Initial framing mode applied once the DZI loads. */
		initialMode?: 'fit' | 'fill';
		/** External horizontal pan override (0 = left, 0.5 = centre, 1 = right). */
		panX?: number;
		/** External vertical pan override (0 = top, 0.5 = centre, 1 = bottom). */
		panY?: number;
		/** External zoom multiplier override relative to the initial fit/fill scale. */
		zoomFactor?: number;
		/** Disables all pan/zoom input. */
		disabled?: boolean;
		/** Enables drag/touch panning. */
		panEnabled?: boolean;
		/** Enables wheel, pinch, and double-click zooming. */
		zoomEnabled?: boolean;
		/** Zoom multiplier per wheel notch. */
		wheelZoomFactor?: number;
		/** Maximum device pixel ratio cap. */
		maxDpr?: number;
		/** Fade-in and crossfade duration in milliseconds. */
		tileFadeDuration?: number;
		/** Draw lime-green outlines around every rendered tile. */
		debug?: boolean;
		/** Clamps pan/zoom within the loaded image bounds. */
		constrainToBounds?: boolean;
		/** Pause tile downloads while the user drags or zooms, resuming shortly after they stop. */
		pauseWhileInteracting?: boolean;
		/** Hold the resolution level while the user drags or zooms, releasing it shortly after they stop. */
		holdResolutionWhileInteracting?: boolean;
		/** Ctrl/⌘ + scroll to zoom and two-finger touch, so the page scrolls past the viewer. */
		cooperativeGestures?: boolean;
	}

	let {
		source,
		stageSize,
		initialMode = 'fit',
		panX = 0.5,
		panY = 0.5,
		zoomFactor = 1,
		disabled = false,
		panEnabled = true,
		zoomEnabled = true,
		wheelZoomFactor = 1.2,
		maxDpr = DEFAULT_MAX_DPR,
		tileFadeDuration = 200,
		debug = false,
		constrainToBounds = false,
		pauseWhileInteracting = true,
		holdResolutionWhileInteracting = true,
		cooperativeGestures = false
	}: Props = $props();

	let viewer: DziViewerMethods | undefined = $state();
	let x = $state(0);
	let y = $state(0);
	let zoom = $state(1);
	let containerSize = $state<Size>({ width: 0, height: 0 });
	let dzi = $state<DziDescriptor | null>(null);
	let isOptimalLoaded = $state(false);
	let hasInitialFramed = $state(false);
	let lastControlSignature = '';

	const constraints = $derived.by((): ViewportConstraints | undefined => {
		if (!constrainToBounds || !dzi) {
			return undefined;
		}
		const { imageBounds } = resolveStageAndImageBounds(dzi, stageSize);
		const fitZoom = viewer?.getFitViewport()?.zoom ?? 0.05;
		return {
			minZoom: fitZoom * 0.5,
			maxZoom: 4,
			bounds: imageBounds,
			minVisibilityRatio: 0.8
		};
	});

	const currentLevel = $derived.by(() => {
		if (!dzi) {
			return null;
		}
		const { imageBounds } = resolveStageAndImageBounds(dzi, stageSize);
		const deviceDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
		return getOptimalLevel(dzi, imageBounds, zoom, clampDpr(deviceDpr, maxDpr));
	});

	// --- Debounced pause/hold during interaction ---

	/** How long after the last drag, wheel or pinch event to resume downloads and release the resolution. */
	const SETTLE_DELAY_MS = 150;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;

	function settle(): void {
		settleTimer = undefined;
		viewer?.releaseResolution();
		viewer?.resumeLoading();
	}

	function handleInteract(): void {
		if (!pauseWhileInteracting && !holdResolutionWhileInteracting) {
			return;
		}
		// Only pause/hold at the start of a gesture; later events just push the settle time back.
		if (settleTimer === undefined) {
			if (pauseWhileInteracting) {
				viewer?.pauseLoading();
			}
			if (holdResolutionWhileInteracting) {
				viewer?.holdResolution();
			}
		}
		clearTimeout(settleTimer);
		settleTimer = setTimeout(settle, SETTLE_DELAY_MS);
	}

	$effect(() => () => clearTimeout(settleTimer));

	function applyViewport(target: Viewport | null): void {
		if (!target) {
			return;
		}
		x = target.x;
		y = target.y;
		zoom = target.zoom;
	}

	function getDetailBounds(): Rect | undefined {
		if (!dzi) {
			return undefined;
		}
		const { imageBounds } = resolveStageAndImageBounds(dzi, stageSize);
		return {
			x: imageBounds.x + imageBounds.width * 0.375,
			y: imageBounds.y + imageBounds.height * 0.55,
			width: imageBounds.width * 0.25,
			height: imageBounds.height * 0.25
		};
	}

	$effect(() => {
		void source;
		hasInitialFramed = false;
		lastControlSignature = '';
	});

	// Apply initial framing and external Storybook control overrides.
	$effect(() => {
		if (!viewer || !dzi || containerSize.width <= 0 || containerSize.height <= 0) {
			return;
		}

		const controlSignature = `${panX}|${panY}|${zoomFactor}|${initialMode}`;
		if (hasInitialFramed && controlSignature === lastControlSignature) {
			return;
		}

		const baseViewport =
			initialMode === 'fill' ? viewer.getFillViewport() : viewer.getFitViewport();
		if (!baseViewport) {
			return;
		}

		const { imageBounds } = resolveStageAndImageBounds(dzi, stageSize);
		applyViewport({
			x: imageBounds.x + panX * imageBounds.width,
			y: imageBounds.y + panY * imageBounds.height,
			zoom: baseViewport.zoom * zoomFactor
		});

		hasInitialFramed = true;
		lastControlSignature = controlSignature;
	});
</script>

<div class="demo-shell">
	<div class="demo-toolbar">
		<button type="button" onclick={() => applyViewport(viewer?.getFitViewport() ?? null)}>
			Override: Fit image
		</button>
		<button type="button" onclick={() => applyViewport(viewer?.getFillViewport() ?? null)}>
			Override: Fill screen
		</button>
		<button
			type="button"
			onclick={() => applyViewport(viewer?.getFitViewport(getDetailBounds()) ?? null)}
		>
			Override: Detail region
		</button>
		<span class="demo-status">
			{#if dzi}
				L{currentLevel ?? '-'} | x {Math.round(x)}, y {Math.round(y)} | zoom {zoom.toFixed(3)} |
				{isOptimalLoaded ? 'Optimal loaded' : 'Loading tiles...'}
			{:else}
				Loading DZI...
			{/if}
		</span>
	</div>

	<p class="demo-hint">
		Drag to pan, scroll/pinch to zoom toward cursor, double-click to zoom in (Shift+double-click to
		zoom out), or use arrow keys and +/- when focused. Toolbar buttons and Controls sliders override
		the bound position.
	</p>

	<div class="demo-stage">
		<PanZoom
			bind:this={viewer}
			{source}
			{stageSize}
			{disabled}
			{panEnabled}
			{zoomEnabled}
			{wheelZoomFactor}
			{cooperativeGestures}
			{maxDpr}
			{tileFadeDuration}
			{debug}
			{constraints}
			bind:x
			bind:y
			bind:zoom
			bind:containerSize
			bind:dzi
			bind:isOptimalLoaded
			onInteract={handleInteract}
			alt="Interactive Deep Zoom Image viewer"
		/>
	</div>
</div>

<style>
	.demo-shell {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
	}

	.demo-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.demo-toolbar button {
		padding: 0.35rem 0.7rem;
		border: 1px solid #cbd5e1;
		border-radius: 4px;
		background: #f8fafc;
		cursor: pointer;
		font-size: 0.85rem;
	}

	.demo-toolbar button:hover {
		background: #e2e8f0;
	}

	.demo-status {
		font-size: 0.8rem;
		color: #475569;
	}

	.demo-hint {
		margin: 0;
		font-size: 0.78rem;
		color: #64748b;
	}

	.demo-stage {
		width: 100%;
		height: 540px;
		background: #0f172a;
		border-radius: 6px;
		overflow: hidden;
	}
</style>
