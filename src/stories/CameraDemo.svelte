<script lang="ts">
	import {
		createCamera,
		DziViewer,
		PanZoom,
		type DziDescriptor,
		type DziViewerMethods,
		type DziViewerSnippetContext,
		type Rect,
		type ScrubPrecacheMode,
		type TransitionCurve,
		type Viewport,
		type ViewportTarget,
		type ViewportTrackStop
	} from '../lib/index.js';
	import {
		BARCELONA_HARBOUR_DZI,
		HERENGRACHT_DZI,
		NOOSA_BEACH_DZI,
		ROMA_STREET_PARKLANDS_DZI
	} from './exampleImages.js';

	interface Props {
		/** Initial DZI source URL (or `null` to demonstrate empty state). */
		source?: string | null;
		/** Demo mode: timed `goTo` transitions or multi-stop `scrubTrack`. */
		mode?: 'transitions' | 'scrub';
		/** Interpolation path (`'direct'` or `'fly'`). */
		curve?: TransitionCurve;
		/** Transition duration in milliseconds. */
		duration?: number;
		/** Curvature factor for `'fly'` transitions (`interpolateZoom.rho`). */
		rho?: number;
		/** Re-frame automatically when the viewer container resizes. */
		refitOnResize?: boolean;
		/** Debounce delay in ms for `PanZoom` tile downloads. */
		loadDebounceMs?: number;
		/** Delay in ms after scrubbing stops before releasing resolution and loading holds. */
		settleDelayMs?: number;
		/** Precache strategy during scrubbing (`'to'`, `'both'`, or `false`). */
		scrubPrecache?: ScrubPrecacheMode;
		/** Allow interactive pan/zoom (`PanZoom`) vs controlled-only (`DziViewer`). */
		interactive?: boolean;
	}

	let {
		source = ROMA_STREET_PARKLANDS_DZI,
		mode = 'transitions',
		curve = 'direct',
		duration = 900,
		rho = 1.42,
		refitOnResize = true,
		loadDebounceMs = 150,
		settleDelayMs = 120,
		scrubPrecache = 'to',
		interactive = true
	}: Props = $props();

	const SOURCE_OPTIONS: ReadonlyArray<{ readonly label: string; readonly value: string | null }> = [
		{ label: 'Roma Street Parklands (8160px)', value: ROMA_STREET_PARKLANDS_DZI },
		{ label: 'Herengracht (4032px)', value: HERENGRACHT_DZI },
		{ label: 'Barcelona Harbour (4032px)', value: BARCELONA_HARBOUR_DZI },
		{ label: 'Noosa Beach (8160px)', value: NOOSA_BEACH_DZI },
		{ label: 'None (cleared)', value: null }
	];

	let selectedSource = $state<string | null | undefined>(undefined);
	const activeSource = $derived(selectedSource === undefined ? source : selectedSource);
	let viewer: DziViewerMethods | undefined = $state();
	let dzi = $state<DziDescriptor | null>(null);
	let isOptimalLoaded = $state(false);
	let isTransitioning = $state(false);
	let lastResult = $state('Ready');
	let isCompactWidth = $state(false);
	let scrubProgress = $state(0);
	let isAutoScrubbing = $state(false);

	// Reset manual dropdown override whenever Storybook's `source` arg changes.
	$effect(() => {
		void source;
		selectedSource = undefined;
	});

	const camera = createCamera(() => viewer, {
		refitOnResize: () => refitOnResize,
		onTransitionChange: (active) => {
			isTransitioning = active;
		}
	});

	$effect(() => () => camera.destroy());

	const regions = $derived.by(
		(): ReadonlyArray<{ readonly name: string; readonly bounds: Rect }> => {
			if (!dzi) {
				return [];
			}
			return [
				{
					name: 'Detail A (left)',
					bounds: {
						x: dzi.width * 0.12,
						y: dzi.height * 0.35,
						width: dzi.width * 0.22,
						height: dzi.height * 0.22
					}
				},
				{
					name: 'Detail B (right)',
					bounds: {
						x: dzi.width * 0.64,
						y: dzi.height * 0.42,
						width: dzi.width * 0.2,
						height: dzi.height * 0.2
					}
				}
			];
		}
	);

	const trackStops = $derived.by((): readonly ViewportTrackStop[] => {
		const [detailA, detailB] = regions;
		if (!detailA || !detailB) {
			return [];
		}
		return [
			{ at: 0, target: 'fit' },
			{ at: 0.35, target: { bounds: detailA.bounds, mode: 'fit', padding: 24 }, curve: 'fly' },
			{ at: 0.72, target: { bounds: detailB.bounds, mode: 'fit', padding: 24 }, curve: 'fly' },
			{ at: 1, target: 'fill', curve: 'direct' }
		];
	});

	async function runTransition(label: string, target: ViewportTarget): Promise<void> {
		lastResult = `Moving to ${label}...`;
		const result = await camera.goTo(target, { curve, duration, rho });
		lastResult = result.cancelled
			? `Cancelled (${label})`
			: `Arrived at ${label} (zoom ${result.viewport.zoom.toFixed(3)})`;
	}

	function applyScrub(nextProgress: number): void {
		scrubProgress = nextProgress;
		if (trackStops.length === 0) {
			return;
		}
		const viewport: Viewport | null = camera.scrubTrack(trackStops, nextProgress, {
			curve,
			rho,
			settleDelayMs,
			precache: scrubPrecache
		});
		if (viewport) {
			lastResult = `Scrub ${(nextProgress * 100).toFixed(0)}% (zoom ${viewport.zoom.toFixed(3)})`;
		}
	}

	// Optional auto-scrub playback for inspecting `scrubTrack` smoothly.
	$effect(() => {
		if (!isAutoScrubbing || mode !== 'scrub') {
			return;
		}
		let frameId = 0;
		let lastTime = performance.now();

		const tick = (now: number) => {
			const deltaSec = (now - lastTime) / 1000;
			lastTime = now;
			const next = scrubProgress + deltaSec * 0.18;
			if (next >= 1) {
				applyScrub(1);
				isAutoScrubbing = false;
				return;
			}
			applyScrub(next);
			frameId = requestAnimationFrame(tick);
		};

		frameId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frameId);
	});
</script>

{#snippet regionOverlays({ stageRectToStyle }: DziViewerSnippetContext)}
	{#each regions as region (region.name)}
		<div class="region-outline" style={stageRectToStyle(region.bounds)}>
			<span class="region-label">{region.name}</span>
		</div>
	{/each}
{/snippet}

<div class="demo-shell">
	<div class="demo-toolbar">
		{#if mode === 'transitions'}
			<button type="button" onclick={() => void runTransition('Fit', 'fit')}>Fit image</button>
			<button type="button" onclick={() => void runTransition('Fill', 'fill')}>Fill screen</button>
			{#each regions as region (region.name)}
				<button
					type="button"
					onclick={() =>
						void runTransition(region.name, { bounds: region.bounds, mode: 'fit', padding: 24 })}
				>
					{region.name}
				</button>
			{/each}
			<button type="button" onclick={() => camera.cancel()} disabled={!isTransitioning}>
				Cancel
			</button>
		{:else}
			<label class="scrub-control">
				<span>Track progress ({Math.round(scrubProgress * 100)}%)</span>
				<input
					type="range"
					min="0"
					max="1"
					step="0.002"
					value={scrubProgress}
					oninput={(event) => {
						isAutoScrubbing = false;
						applyScrub(Number(event.currentTarget.value));
					}}
				/>
			</label>
			<button
				type="button"
				onclick={() => {
					if (scrubProgress >= 1) {
						applyScrub(0);
					}
					isAutoScrubbing = !isAutoScrubbing;
				}}
			>
				{isAutoScrubbing ? 'Pause scrub' : 'Auto-scrub'}
			</button>
		{/if}

		<button type="button" onclick={() => (isCompactWidth = !isCompactWidth)}>
			{isCompactWidth ? 'Expand container (100%)' : 'Shrink container (60%)'}
		</button>

		<label class="source-select">
			<span>Source</span>
			<select
				value={activeSource ?? ''}
				onchange={(event) => {
					const val = event.currentTarget.value;
					selectedSource = val === '' ? null : val;
					scrubProgress = 0;
					isAutoScrubbing = false;
					lastResult = selectedSource ? 'Source changed' : 'Cleared';
				}}
			>
				{#each SOURCE_OPTIONS as option (option.label)}
					<option value={option.value ?? ''}>{option.label}</option>
				{/each}
			</select>
		</label>
	</div>

	<div class="demo-status">
		<span>Status: {lastResult}</span>
		<span>| Curve: {curve}</span>
		<span>| {isTransitioning ? 'Transitioning' : 'Idle'}</span>
		<span>
			| {isOptimalLoaded ? 'Optimal loaded' : activeSource ? 'Loading tiles...' : 'Empty'}
		</span>
	</div>

	<div class="demo-stage" class:compact={isCompactWidth}>
		{#if interactive}
			<PanZoom
				bind:this={viewer}
				source={activeSource}
				initialView="fit"
				{loadDebounceMs}
				bind:dzi
				bind:isOptimalLoaded
				alt="Deep Zoom camera demo"
				children={regionOverlays}
			/>
		{:else}
			<DziViewer
				bind:this={viewer}
				source={activeSource}
				initialView="fit"
				bind:dzi
				bind:isOptimalLoaded
				alt="Deep Zoom camera demo"
				children={regionOverlays}
			/>
		{/if}
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

	.demo-toolbar button,
	.demo-toolbar select {
		padding: 0.35rem 0.7rem;
		border: 1px solid #cbd5e1;
		border-radius: 4px;
		background: #f8fafc;
		color: #0f172a;
		cursor: pointer;
		font-size: 0.85rem;
	}

	.demo-toolbar button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.demo-toolbar button:hover:not(:disabled) {
		background: #e2e8f0;
	}

	.scrub-control,
	.source-select {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.85rem;
		color: #0f172a;
	}

	.scrub-control input[type='range'] {
		width: 200px;
	}

	.demo-status {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: #334155;
	}

	.demo-stage {
		width: 100%;
		height: 520px;
		background: #0f172a;
		border-radius: 6px;
		overflow: hidden;
		transition: width 150ms ease;
	}

	.demo-stage.compact {
		width: 60%;
	}

	.region-outline {
		border: 2px dashed rgba(56, 189, 248, 0.9);
		background: rgba(56, 189, 248, 0.1);
		box-sizing: border-box;
		pointer-events: none;
	}

	.region-label {
		display: inline-block;
		padding: 0.15rem 0.4rem;
		background: #0f172a;
		color: #f8fafc;
		font-size: 0.72rem;
		font-weight: 600;
	}
</style>
