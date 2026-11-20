<script lang="ts">
	import { cubicInOut } from 'svelte/easing';
	import { Tween } from 'svelte/motion';
	import { clampDpr, DEFAULT_MAX_DPR, getOptimalLevel } from '../../tiling.js';
	import type { DziDescriptor, PrecacheResult, Rect, Size, Viewport } from '../../types.js';
	import { resolveStageAndImageBounds } from '../../viewport.js';
	import DziViewer from './DziViewer.svelte';
	import type { DziViewerMethods } from './dziViewerTypes.js';

	interface Props {
		/** DZI descriptor URL to display. */
		source: string;
		/** Optional virtual stage size to demonstrate custom coordinate spaces. */
		stageSize?: Size;
		/** Initial framing mode applied once the DZI loads. */
		initialMode?: 'fit' | 'fill';
		/** Horizontal pan position normalised across the image width (0 = left, 0.5 = centre, 1 = right). */
		panX?: number;
		/** Vertical pan position normalised across the image height (0 = top, 0.5 = centre, 1 = bottom). */
		panY?: number;
		/** Zoom multiplier relative to the initial fit/fill scale. */
		zoomFactor?: number;
		/** Maximum device pixel ratio cap used for optimal level selection. */
		maxDpr?: number;
		/** Fade-in and crossfade duration for loaded tiles in milliseconds. */
		tileFadeDuration?: number;
		/** Most new tiles mounted per animation frame. */
		maxTileMountsPerFrame?: number;
		/** Pause tile downloads while a tween runs, precaching only the destination. */
		pauseWhileAnimating?: boolean;
		/** Hold the current resolution level while a tween runs, so tiles aren't remounted at every level. */
		holdResolutionWhileAnimating?: boolean;
	}

	let {
		source,
		stageSize,
		initialMode = 'fit',
		panX = 0.5,
		panY = 0.5,
		zoomFactor = 1,
		maxDpr = DEFAULT_MAX_DPR,
		tileFadeDuration = 200,
		maxTileMountsPerFrame,
		pauseWhileAnimating = true,
		holdResolutionWhileAnimating = true
	}: Props = $props();

	let viewer: DziViewerMethods | undefined = $state();
	let containerSize = $state<Size>({ width: 0, height: 0 });
	let dzi = $state<DziDescriptor | null>(null);
	let isOptimalLoaded = $state(false);
	let precacheStatus = $state('');
	let hasInitialFramed = $state(false);
	let lastControlSignature = '';

	const tweenX = new Tween(0, { duration: 650, easing: cubicInOut });
	const tweenY = new Tween(0, { duration: 650, easing: cubicInOut });
	const tweenZoom = new Tween(1, { duration: 650, easing: cubicInOut });

	// The status line reads the tween's target, not `current`, so it only re-renders when a move starts.
	const targetLevel = $derived.by(() => {
		if (!dzi) {
			return null;
		}
		const { imageBounds } = resolveStageAndImageBounds(dzi, stageSize);
		const deviceDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
		return getOptimalLevel(dzi, imageBounds, tweenZoom.target, clampDpr(deviceDpr, maxDpr));
	});

	/** Increments per move, so only the latest tween resumes loading and releases the resolution. */
	let animationId = 0;

	/**
	 * Tweens to `viewport`. While it runs, optionally pauses downloads (precaching only the destination)
	 * and holds the resolution level, then restores both once the latest tween finishes.
	 */
	async function moveTo(viewport: Viewport | null, immediate = false): Promise<void> {
		if (!viewport) {
			return;
		}
		if (immediate) {
			await Promise.all([
				tweenX.set(viewport.x, { duration: 0 }),
				tweenY.set(viewport.y, { duration: 0 }),
				tweenZoom.set(viewport.zoom, { duration: 0 })
			]);
			return;
		}

		const currentAnimationId = ++animationId;
		if (pauseWhileAnimating) {
			viewer?.pauseLoading();
			void viewer?.precacheViewport(viewport);
		}
		if (holdResolutionWhileAnimating) {
			viewer?.holdResolution();
		}

		// An interrupted tween's promise may never settle; the newer move restores the viewer instead.
		await Promise.all([
			tweenX.set(viewport.x),
			tweenY.set(viewport.y),
			tweenZoom.set(viewport.zoom)
		]);
		if (currentAnimationId !== animationId) {
			return;
		}
		viewer?.releaseResolution();
		viewer?.resumeLoading();
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

	function getCornerBounds(): Rect | undefined {
		if (!dzi) {
			return undefined;
		}
		const { imageBounds } = resolveStageAndImageBounds(dzi, stageSize);
		return {
			x: imageBounds.x + imageBounds.width * 0.62,
			y: imageBounds.y + imageBounds.height * 0.55,
			width: imageBounds.width * 0.22,
			height: imageBounds.height * 0.22
		};
	}

	// Reset framing state when source changes.
	$effect(() => {
		void source;
		hasInitialFramed = false;
		lastControlSignature = '';
		precacheStatus = '';
	});

	// Apply initial framing and live pan/zoom slider updates from Storybook controls.
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
		void moveTo(
			{
				x: imageBounds.x + panX * imageBounds.width,
				y: imageBounds.y + panY * imageBounds.height,
				zoom: baseViewport.zoom * zoomFactor
			},
			true
		);

		hasInitialFramed = true;
		lastControlSignature = controlSignature;
	});

	async function handlePrecacheDetail(): Promise<void> {
		const bounds = getDetailBounds();
		if (!viewer || !bounds) {
			return;
		}
		precacheStatus = 'Pre-caching detail viewport...';
		const result: PrecacheResult = await viewer.precacheBounds(bounds, 'fit');
		precacheStatus = `Pre-cached ${result.loaded}/${result.total} tiles (${result.failed} failed)`;
	}
</script>

<div class="demo-shell">
	<div class="demo-toolbar">
		<button type="button" onclick={() => void moveTo(viewer?.getFitViewport() ?? null)}>
			Fit image
		</button>
		<button type="button" onclick={() => void moveTo(viewer?.getFillViewport() ?? null)}>
			Fill screen
		</button>
		<button
			type="button"
			onclick={() => void moveTo(viewer?.getFitViewport(getDetailBounds()) ?? null)}
		>
			Tween to detail
		</button>
		<button
			type="button"
			onclick={() => void moveTo(viewer?.getFitViewport(getCornerBounds()) ?? null)}
		>
			Tween to corner
		</button>
		<button type="button" onclick={() => void handlePrecacheDetail()}> Pre-cache detail </button>
		<span class="demo-status">
			{#if dzi}
				{dzi.width}×{dzi.height} | target L{targetLevel ?? '-'} | maxDpr {maxDpr} | target zoom
				{tweenZoom.target.toFixed(3)} |
				{isOptimalLoaded ? 'Optimal loaded' : 'Loading tiles...'}
			{:else}
				Loading DZI...
			{/if}
			{#if precacheStatus}
				| {precacheStatus}
			{/if}
		</span>
	</div>

	<div class="demo-stage">
		<DziViewer
			bind:this={viewer}
			{source}
			{stageSize}
			{maxDpr}
			{tileFadeDuration}
			{maxTileMountsPerFrame}
			x={tweenX.current}
			y={tweenY.current}
			zoom={tweenZoom.current}
			bind:containerSize
			bind:dzi
			bind:isOptimalLoaded
			alt="Deep Zoom Image preview"
		/>
	</div>
</div>

<style>
	.demo-shell {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
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

	.demo-stage {
		width: 100%;
		height: 540px;
		background: #0f172a;
		border-radius: 6px;
		overflow: hidden;
	}
</style>
