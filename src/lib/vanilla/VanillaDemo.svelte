<script lang="ts">
	import { untrack } from 'svelte';
	import { DEFAULT_MAX_DPR } from '../tiling.js';
	import type { PrecacheResult, Rect, Size, Viewport } from '../types.js';
	import { resolveStageAndImageBounds } from '../viewport.js';
	import {
		createOpenSeahorse,
		createPanZoom,
		type OpenSeahorseController,
		type PanZoomController,
		type ViewerStateSnapshot
	} from './createViewer.svelte.js';

	interface Props {
		/** Which vanilla constructor to mount (`panzoom` or base `viewer`). */
		mode?: 'panzoom' | 'viewer';
		/** DZI descriptor URL to display. */
		source: string;
		/** Optional virtual stage size. */
		stageSize?: Size;
		/** Initial framing mode applied once the DZI loads. */
		initialMode?: 'fit' | 'fill';
		/** Normalised horizontal pan override (0..1) applied via `controller.update()`. */
		panX?: number;
		/** Normalised vertical pan override (0..1) applied via `controller.update()`. */
		panY?: number;
		/** Zoom multiplier override relative to the initial fit/fill scale. */
		zoomFactor?: number;
		/** Maximum device pixel ratio cap passed through via `controller.update()`. */
		maxDpr?: number;
		/** Tile fade duration in milliseconds passed through via `controller.update()`. */
		tileFadeDuration?: number;
		/** Disables PanZoom input when `mode === 'panzoom'`. */
		disabled?: boolean;
		/** Enables drag/touch panning when `mode === 'panzoom'`. */
		panEnabled?: boolean;
		/** Enables wheel/pinch/double-click zooming when `mode === 'panzoom'`. */
		zoomEnabled?: boolean;
	}

	let {
		mode = 'panzoom',
		source,
		stageSize,
		initialMode = 'fit',
		panX = 0.5,
		panY = 0.5,
		zoomFactor = 1,
		maxDpr = DEFAULT_MAX_DPR,
		tileFadeDuration = 200,
		disabled = false,
		panEnabled = true,
		zoomEnabled = true
	}: Props = $props();

	let mountTarget: HTMLDivElement | undefined = $state();
	let controller: OpenSeahorseController | PanZoomController | null = null;
	let snapshot = $state<ViewerStateSnapshot>({
		x: 0,
		y: 0,
		zoom: 1,
		containerSize: { width: 0, height: 0 },
		dzi: null,
		isOptimalLoaded: false
	});
	let precacheStatus = $state('');
	let hasInitialFramed = false;
	let lastControlSignature = '';

	function applyInitialOrControlViewport(
		activeController: OpenSeahorseController | PanZoomController,
		currentState: ViewerStateSnapshot,
		force: boolean
	): void {
		if (
			!currentState.dzi ||
			currentState.containerSize.width <= 0 ||
			currentState.containerSize.height <= 0
		) {
			return;
		}

		const signature = `${panX}|${panY}|${zoomFactor}|${initialMode}`;
		if (!force && hasInitialFramed && signature === lastControlSignature) {
			return;
		}

		const baseViewport =
			initialMode === 'fill'
				? activeController.getFillViewport()
				: activeController.getFitViewport();
		if (!baseViewport) {
			return;
		}

		const { imageBounds } = resolveStageAndImageBounds(currentState.dzi, stageSize);
		activeController.setViewport({
			x: imageBounds.x + panX * imageBounds.width,
			y: imageBounds.y + panY * imageBounds.height,
			zoom: baseViewport.zoom * zoomFactor
		});

		hasInitialFramed = true;
		lastControlSignature = signature;
	}

	// Imperatively mount the vanilla library into a plain DOM node and destroy it on cleanup.
	$effect(() => {
		const target = mountTarget;
		const currentMode = mode;
		if (!target) {
			return;
		}

		hasInitialFramed = false;
		lastControlSignature = '';
		precacheStatus = '';

		const initialOptions = untrack(() => ({
			source,
			stageSize,
			maxDpr,
			tileFadeDuration,
			alt: 'Vanilla mounted Deep Zoom viewer',
			onStateChange: (nextState: ViewerStateSnapshot) => {
				snapshot = nextState;
				if (controller && !hasInitialFramed) {
					applyInitialOrControlViewport(controller, nextState, false);
				}
			}
		}));

		const instance =
			currentMode === 'panzoom'
				? createPanZoom(target, {
						...initialOptions,
						...untrack(() => ({ disabled, panEnabled, zoomEnabled }))
					})
				: createOpenSeahorse(target, initialOptions);

		controller = instance;
		snapshot = instance.getState();

		return () => {
			instance.destroy();
			if (controller === instance) {
				controller = null;
			}
		};
	});

	// Forward non-positional configuration props via `controller.update()` without resetting pan/zoom.
	$effect(() => {
		if (!controller) {
			return;
		}

		const sharedProps = {
			source,
			stageSize,
			maxDpr,
			tileFadeDuration
		};

		if (mode === 'panzoom') {
			controller.update({
				...sharedProps,
				disabled,
				panEnabled,
				zoomEnabled
			});
		} else {
			controller.update(sharedProps);
		}
	});

	// Reset framing flag when source changes.
	$effect(() => {
		void source;
		hasInitialFramed = false;
		lastControlSignature = '';
		precacheStatus = '';
	});

	// Forward pan/zoom Storybook control changes via `controller.setViewport()`.
	$effect(() => {
		void panX;
		void panY;
		void zoomFactor;
		void initialMode;
		if (!controller) {
			return;
		}
		applyInitialOrControlViewport(controller, snapshot, false);
	});

	function moveTo(target: Viewport | null): void {
		if (!controller || !target) {
			return;
		}
		controller.setViewport(target);
	}

	function getDetailBounds(): Rect | undefined {
		if (!snapshot.dzi) {
			return undefined;
		}
		const { imageBounds } = resolveStageAndImageBounds(snapshot.dzi, stageSize);
		return {
			x: imageBounds.x + imageBounds.width * 0.35,
			y: imageBounds.y + imageBounds.height * 0.3,
			width: imageBounds.width * 0.25,
			height: imageBounds.height * 0.25
		};
	}

	async function handlePrecacheDetail(): Promise<void> {
		const bounds = getDetailBounds();
		if (!controller || !bounds) {
			return;
		}
		precacheStatus = 'Pre-caching...';
		const result: PrecacheResult = await controller.precacheBounds(bounds, 'fit');
		precacheStatus = `Pre-cached ${result.loaded}/${result.total} tiles`;
	}
</script>

<div class="demo-shell">
	<div class="demo-toolbar">
		<button type="button" onclick={() => moveTo(controller?.getFitViewport() ?? null)}>
			controller.setViewport(fit)
		</button>
		<button type="button" onclick={() => moveTo(controller?.getFillViewport() ?? null)}>
			controller.setViewport(fill)
		</button>
		<button
			type="button"
			onclick={() => moveTo(controller?.getFitViewport(getDetailBounds()) ?? null)}
		>
			controller.setViewport(detail)
		</button>
		<button type="button" onclick={() => void handlePrecacheDetail()}>
			controller.precacheBounds(detail)
		</button>
		<span class="demo-status">
			{#if snapshot.dzi}
				x {Math.round(snapshot.x)}, y {Math.round(snapshot.y)} | zoom {snapshot.zoom.toFixed(3)} |
				{snapshot.isOptimalLoaded ? 'Optimal loaded' : 'Loading tiles...'}
			{:else}
				Loading DZI...
			{/if}
			{#if precacheStatus}
				| {precacheStatus}
			{/if}
		</span>
	</div>

	<div class="demo-stage" bind:this={mountTarget}></div>
</div>

<style>
	.demo-shell {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
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
		font-size: 0.82rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
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
