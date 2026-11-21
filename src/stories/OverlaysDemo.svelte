<script lang="ts">
	import {
		createCamera,
		PanZoom,
		type DziDescriptor,
		type DziViewerMethods,
		type DziViewerSnippetContext,
		type Rect
	} from '../lib/index.js';
	import { BARCELONA_HARBOUR_DZI } from './exampleImages.js';

	interface Props {
		/** DZI descriptor URL to display. */
		source?: string;
		/** Demo variant: interactive crop box + pins, or aligned full-image SVG grid overlay. */
		variant?: 'interactive-crop' | 'aligned-layer';
		/** Opacity (0..1) of the aligned full-image overlay in `aligned-layer` mode. */
		overlayOpacity?: number;
		/** Debounce delay in ms for `PanZoom` tile downloads. */
		loadDebounceMs?: number;
	}

	let {
		source = BARCELONA_HARBOUR_DZI,
		variant = 'interactive-crop',
		overlayOpacity = 0.7,
		loadDebounceMs = 150
	}: Props = $props();

	let viewer: DziViewerMethods | undefined = $state();
	let dzi = $state<DziDescriptor | null>(null);
	let cropBounds = $state<Rect | null>(null);
	let activeDrag = $state<{
		readonly startX: number;
		readonly startY: number;
		readonly startBounds: Rect;
	} | null>(null);

	const camera = createCamera(() => viewer, {
		curve: 'fly',
		duration: 800
	});

	$effect(() => () => camera.destroy());

	// Seed a default crop box once the DZI loads.
	$effect(() => {
		if (!dzi) {
			cropBounds = null;
			return;
		}
		cropBounds = {
			x: Math.round(dzi.width * 0.25),
			y: Math.round(dzi.height * 0.3),
			width: Math.round(dzi.width * 0.35),
			height: Math.round(dzi.height * 0.32)
		};
	});

	const pins = $derived.by(() => {
		if (!dzi) {
			return [];
		}
		return [
			{ id: 'harbour', label: 'Harbour', x: dzi.width * 0.32, y: dzi.height * 0.45 },
			{ id: 'pier', label: 'Pier', x: dzi.width * 0.68, y: dzi.height * 0.52 }
		];
	});

	function resetCropBox(): void {
		if (!dzi) {
			return;
		}
		cropBounds = {
			x: Math.round(dzi.width * 0.25),
			y: Math.round(dzi.height * 0.3),
			width: Math.round(dzi.width * 0.35),
			height: Math.round(dzi.height * 0.32)
		};
	}

	function handleCropPointerDown(event: PointerEvent): void {
		if (!cropBounds || event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();

		activeDrag = {
			startX: event.clientX,
			startY: event.clientY,
			startBounds: { ...cropBounds }
		};

		window.addEventListener('pointermove', handleCropPointerMove);
		window.addEventListener('pointerup', handleCropPointerUp);
	}

	function handleCropPointerMove(event: PointerEvent): void {
		if (!activeDrag || !dzi) {
			return;
		}
		const currentZoom = viewer?.getViewport().zoom ?? 0;
		if (currentZoom <= 0) {
			return;
		}
		const deltaX = (event.clientX - activeDrag.startX) / currentZoom;
		const deltaY = (event.clientY - activeDrag.startY) / currentZoom;
		const maxX = Math.max(0, dzi.width - activeDrag.startBounds.width);
		const maxY = Math.max(0, dzi.height - activeDrag.startBounds.height);

		cropBounds = {
			...activeDrag.startBounds,
			x: Math.round(Math.min(maxX, Math.max(0, activeDrag.startBounds.x + deltaX))),
			y: Math.round(Math.min(maxY, Math.max(0, activeDrag.startBounds.y + deltaY)))
		};
	}

	function handleCropPointerUp(): void {
		if (!activeDrag) {
			return;
		}
		activeDrag = null;
		window.removeEventListener('pointermove', handleCropPointerMove);
		window.removeEventListener('pointerup', handleCropPointerUp);
	}

	$effect(() => {
		return () => {
			window.removeEventListener('pointermove', handleCropPointerMove);
			window.removeEventListener('pointerup', handleCropPointerUp);
		};
	});
</script>

{#snippet overlayContent({
	imageBounds,
	stageToScreen,
	stageRectToScreen,
	stageRectToStyle
}: DziViewerSnippetContext)}
	{#if variant === 'interactive-crop'}
		{#if cropBounds}
			{@const screenBox = stageRectToScreen(cropBounds)}
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="crop-box"
				style={stageRectToStyle(cropBounds)}
				role="region"
				aria-label="Draggable crop region"
				onpointerdown={handleCropPointerDown}
				ondblclick={(event) => event.stopPropagation()}
			>
				<span class="crop-badge">
					Drag me (wheel zooms through) | {Math.round(screenBox.width)}×{Math.round(
						screenBox.height
					)}px
				</span>
			</div>
		{/if}

		{#each pins as pin (pin.id)}
			{@const pos = stageToScreen({ x: pin.x, y: pin.y })}
			<div
				class="stage-pin"
				style:transform="translate3d({pos.x}px, {pos.y}px, 0) translate(-50%, -100%)"
			>
				{pin.label}
			</div>
		{/each}
	{:else if imageBounds}
		<svg
			class="aligned-grid"
			style={stageRectToStyle(imageBounds)}
			style:opacity={overlayOpacity}
			viewBox="0 0 100 100"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<rect
				x="0.5"
				y="0.5"
				width="99"
				height="99"
				fill="none"
				stroke="#38bdf8"
				stroke-width="0.6"
			/>
			<line
				x1="33.33"
				y1="0"
				x2="33.33"
				y2="100"
				stroke="#38bdf8"
				stroke-width="0.35"
				stroke-dasharray="2 2"
			/>
			<line
				x1="66.66"
				y1="0"
				x2="66.66"
				y2="100"
				stroke="#38bdf8"
				stroke-width="0.35"
				stroke-dasharray="2 2"
			/>
			<line
				x1="0"
				y1="33.33"
				x2="100"
				y2="33.33"
				stroke="#38bdf8"
				stroke-width="0.35"
				stroke-dasharray="2 2"
			/>
			<line
				x1="0"
				y1="66.66"
				x2="100"
				y2="66.66"
				stroke="#38bdf8"
				stroke-width="0.35"
				stroke-dasharray="2 2"
			/>
		</svg>
	{/if}
{/snippet}

<div class="demo-shell">
	<div class="demo-toolbar">
		<button type="button" onclick={() => void camera.fitBounds()}>Fit full image</button>
		{#if variant === 'interactive-crop'}
			<button
				type="button"
				disabled={!cropBounds}
				onclick={() => cropBounds && void camera.fitBounds(cropBounds, { padding: 32 })}
			>
				Fly to crop box
			</button>
			<button type="button" onclick={resetCropBox}>Reset crop box</button>
		{/if}
		<span class="demo-status">
			{#if cropBounds && variant === 'interactive-crop'}
				Crop: ({cropBounds.x}, {cropBounds.y}) {cropBounds.width}×{cropBounds.height}
			{:else if dzi}
				Image: {dzi.width}×{dzi.height} | Aligned SVG grid overlay
			{:else}
				Loading DZI...
			{/if}
		</span>
	</div>

	<div class="demo-stage">
		<PanZoom
			bind:this={viewer}
			{source}
			initialView={{ mode: 'fit', padding: 24 }}
			{loadDebounceMs}
			disabled={Boolean(activeDrag)}
			bind:dzi
			alt="Deep Zoom overlays demo"
			children={overlayContent}
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
		color: #0f172a;
		cursor: pointer;
		font-size: 0.85rem;
	}

	.demo-toolbar button:hover:not(:disabled) {
		background: #e2e8f0;
	}

	.demo-status {
		font-size: 0.8rem;
		color: #334155;
	}

	.demo-stage {
		width: 100%;
		height: 520px;
		background: #0f172a;
		border-radius: 6px;
		overflow: hidden;
	}

	.crop-box {
		border: 2px dashed #2563eb;
		background: rgba(37, 99, 235, 0.16);
		box-sizing: border-box;
		cursor: move;
		pointer-events: auto;
	}

	.crop-badge {
		display: inline-block;
		padding: 0.2rem 0.45rem;
		background: #1e3a8a;
		color: #ffffff;
		font-size: 0.72rem;
		font-weight: 600;
		pointer-events: none;
	}

	.stage-pin {
		position: absolute;
		top: 0;
		left: 0;
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
		background: #0f172a;
		color: #ffffff;
		border: 1px solid #38bdf8;
		font-size: 0.75rem;
		font-weight: 600;
		white-space: nowrap;
		pointer-events: none;
	}

	.aligned-grid {
		pointer-events: none;
	}
</style>
