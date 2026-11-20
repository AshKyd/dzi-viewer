<script lang="ts">
	import { untrack } from 'svelte';
	import { devicePixelRatio } from 'svelte/reactivity/window';
	import { getClosestSingleTileLevel, getTileStageRect, loadDzi } from '../../dzi.js';
	import { DEFAULT_MAX_TILE_MOUNTS_PER_FRAME, limitTileChanges } from '../../mountBudget.js';
	import {
		EMPTY_PRECACHE_RESULT,
		precacheBounds as runPrecacheBounds,
		precacheViewport as runPrecacheViewport
	} from '../../precache.js';
	import { computeRenderPlan } from '../../retention.js';
	import { TileCache } from '../../tileCache.js';
	import { DEFAULT_MAX_CONCURRENT_LOADS, TileLoader } from '../../tileLoader.js';
	import {
		buildSingleTileSpec,
		clampDpr,
		DEFAULT_MAX_DPR,
		getTilesForViewport
	} from '../../tiling.js';
	import type {
		DziDescriptor,
		Point,
		PrecacheOptions,
		PrecacheResult,
		Rect,
		RenderLevelLayer,
		Size,
		TileSpec,
		Viewport,
		ViewportFitOptions
	} from '../../types.js';
	import {
		clampViewport,
		getFillViewport as computeFillViewport,
		getFitViewport as computeFitViewport,
		resolveStageAndImageBounds,
		screenToStage as convertScreenToStage,
		stageToScreen as convertStageToScreen
	} from '../../viewport.js';
	import type { DziViewerProps } from './dziViewerTypes.js';
	import { attachTileImage } from './tileImageAction.js';

	let {
		source,
		x = $bindable(0),
		y = $bindable(0),
		zoom = $bindable(1),
		stageSize,
		imageBounds,
		containerSize = $bindable<Size>({ width: 0, height: 0 }),
		dzi = $bindable<DziDescriptor | null>(null),
		isOptimalLoaded = $bindable(false),
		dpr,
		maxDpr = DEFAULT_MAX_DPR,
		quality = 1,
		constraints,
		maxConcurrentLoads = DEFAULT_MAX_CONCURRENT_LOADS,
		maxCachedTiles = 256,
		maxRetries = 1,
		failedTileRetryDelay = 5000,
		preloadBaseLevel = true,
		tileFadeDuration = 200,
		maxTileMountsPerFrame = DEFAULT_MAX_TILE_MOUNTS_PER_FRAME,
		crossOrigin,
		getTileUrl,
		alt = '',
		class: className = '',
		onLoad,
		onError,
		onTileError
	}: DziViewerProps = $props();

	let containerEl: HTMLDivElement | undefined = $state();
	let cacheVersion = $state(0);
	let sourceId = $state('source-0');
	let sourceCounter = 0;
	let lastActiveRequestSignature = '';
	/** Pyramid level the viewer won't go above while `holdResolution()` is active. */
	let heldLevel = $state<number | undefined>();

	// Deliberately not reactive: `bumpCacheVersion()` re-runs the render plan when this changes.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const opaqueTileKeys = new Set<string>();

	let pendingCacheVersionFrame: number | undefined;

	/**
	 * Marks the cache as changed so the render plan is rebuilt.
	 * Tile loads and fade-ins arrive in bursts (up to `maxConcurrentLoads` at once, then a fade-in each),
	 * so changes are batched into at most one rebuild per animation frame instead of one per event.
	 */
	function bumpCacheVersion(): void {
		if (pendingCacheVersionFrame !== undefined) {
			return;
		}
		if (typeof requestAnimationFrame === 'undefined') {
			cacheVersion = untrack(() => cacheVersion) + 1;
			return;
		}
		pendingCacheVersionFrame = requestAnimationFrame(() => {
			pendingCacheVersionFrame = undefined;
			cacheVersion = untrack(() => cacheVersion) + 1;
		});
	}

	function handleTileOpaque(key: string): void {
		if (opaqueTileKeys.has(key)) {
			return;
		}
		opaqueTileKeys.add(key);
		bumpCacheVersion();
	}

	/** With fades off, a tile covers what's underneath as soon as it's in the DOM. */
	function handleTileMount(key: string): void {
		if (untrack(() => tileFadeDuration) > 0) {
			return;
		}
		handleTileOpaque(key);
	}

	function handleTileUnmount(key: string): void {
		opaqueTileKeys.delete(key);
	}

	/**
	 * `animationend` bubbles, so one listener on the viewport catches every tile's fade-in finishing.
	 * Tiles removed mid-fade never fire it, which is fine: they're no longer covering anything.
	 */
	function handleTileAnimationEnd(event: AnimationEvent): void {
		if (event.animationName !== 'dzi-fade-in' || !(event.target instanceof HTMLElement)) {
			return;
		}
		const { tileKey } = event.target.dataset;
		if (tileKey) {
			handleTileOpaque(tileKey);
		}
	}

	const cache = new TileCache();
	const loader = new TileLoader({ cache, onChange: bumpCacheVersion });

	// --- Derived viewer state ---

	const effectiveDpr = $derived(clampDpr(dpr ?? devicePixelRatio.current ?? 1, maxDpr));

	const resolvedStage = $derived(
		dzi ? resolveStageAndImageBounds(dzi, stageSize, imageBounds) : null
	);

	const effectiveViewport = $derived(clampViewport({ x, y, zoom }, constraints, containerSize));

	const baseTileSpec = $derived.by((): TileSpec | null => {
		if (!dzi || !resolvedStage || !preloadBaseLevel) {
			return null;
		}
		const baseLevel = getClosestSingleTileLevel(dzi);
		const spec = buildSingleTileSpec(dzi, resolvedStage.imageBounds, baseLevel, 0, 0, sourceId);
		if (!spec) {
			return null;
		}
		// Give the single-tile preview top priority so the stage populates immediately.
		return { ...spec, distanceSq: -1 };
	});

	const hasContainerSize = $derived(containerSize.width > 0 && containerSize.height > 0);

	const tileSelection = $derived.by(() => {
		if (!dzi || !resolvedStage || !hasContainerSize) {
			return null;
		}

		return getTilesForViewport({
			dzi,
			imageBounds: resolvedStage.imageBounds,
			viewport: effectiveViewport,
			containerSize,
			dpr: effectiveDpr,
			maxDpr,
			quality,
			sourceId,
			maxLevel: heldLevel
		});
	});

	const renderPlan = $derived.by(() => {
		// Re-evaluate whenever cached tiles finish decoding or fail.
		void cacheVersion;

		if (!dzi || !tileSelection) {
			return { layers: [], isOptimalLoaded: false, mountedTileKeys: new Set<string>() };
		}

		return computeRenderPlan({
			dzi,
			optimalLevel: tileSelection.level,
			optimalTiles: tileSelection.tiles,
			visibleBounds: tileSelection.visibleBounds,
			cache,
			// Always passed: with the mount budget, a ready tile may not be in the DOM yet, so even with
			// fades off it only covers fallbacks once it has mounted (see `handleTileMount`).
			opaqueTileKeys
		});
	});

	// --- Per-frame mount budget ---

	/** Tile layers actually in the DOM. Moves towards `renderPlan.layers` a few tiles per frame. */
	let displayedLayers = $state.raw<readonly RenderLevelLayer[]>([]);
	let hasPendingTileChanges = $state(false);
	let pendingMountFrame: number | undefined;

	const isMountBudgeted = $derived(Number.isFinite(maxTileMountsPerFrame));
	/**
	 * Layers in a fixed DOM order (by level). Stacking comes from each layer's `z-index`, so this order never
	 * changes what's drawn. The plan's order shifts as fallbacks come and go, and a keyed `{#each}` would
	 * otherwise physically move whole layers in the DOM to match.
	 */
	const renderedLayers = $derived(
		[...(isMountBudgeted ? displayedLayers : renderPlan.layers)].sort((a, b) => a.level - b.level)
	);

	/** Applies one frame's worth of tile adds and removes, and schedules the next frame if any are left. */
	function applyMountBudget(): void {
		untrack(() => {
			const maxAdds = Math.max(1, maxTileMountsPerFrame);
			const { layers, pending } = limitTileChanges({
				displayed: displayedLayers,
				planned: renderPlan.layers,
				maxAdds,
				// Removing a tile is cheaper than creating one.
				maxRemoves: maxAdds * 2,
				viewportCentre: effectiveViewport
			});
			displayedLayers = layers;
			hasPendingTileChanges = pending;
			if (pending) {
				scheduleMountBudget();
			}
		});
	}

	function scheduleMountBudget(): void {
		if (pendingMountFrame !== undefined) {
			return;
		}
		if (typeof requestAnimationFrame === 'undefined') {
			applyMountBudget();
			return;
		}
		pendingMountFrame = requestAnimationFrame(() => {
			pendingMountFrame = undefined;
			applyMountBudget();
		});
	}

	// --- Effects ---

	// Keep loader and cache configuration in sync with reactive props.
	$effect(() => {
		cache.setMaxCachedTiles(maxCachedTiles);
		loader.configure({
			maxConcurrent: maxConcurrentLoads,
			maxRetries,
			failedTileRetryDelay,
			crossOrigin,
			onTileError
		});
	});

	// Dispose loader on unmount so pending precache promises settle cleanly.
	$effect(() => {
		return () => {
			loader.dispose();
			if (pendingCacheVersionFrame !== undefined) {
				cancelAnimationFrame(pendingCacheVersionFrame);
			}
			if (pendingMountFrame !== undefined) {
				cancelAnimationFrame(pendingMountFrame);
			}
		};
	});

	// Move the DOM towards each new render plan, a budgeted number of tiles per frame.
	$effect(() => {
		const { layers } = renderPlan;
		if (isMountBudgeted) {
			scheduleMountBudget();
			return;
		}
		// Unbudgeted, the template renders the plan directly. Track it so turning the budget back on carries on
		// from what's on screen instead of re-adding every tile.
		displayedLayers = layers;
		hasPendingTileChanges = false;
	});

	// Tiles caught mid-fade when fading is turned off never fire `animationend`, so mark everything on screen opaque.
	$effect(() => {
		if (tileFadeDuration > 0) {
			return;
		}
		untrack(() => renderedLayers).forEach((layer) =>
			layer.tiles.forEach((tile) => opaqueTileKeys.add(tile.key))
		);
		bumpCacheVersion();
	});

	// Observe container size changes via ResizeObserver.
	$effect(() => {
		const el = containerEl;
		if (!el) {
			return;
		}

		// Untracked so writing `containerSize` doesn't re-run this effect and rebuild the observer.
		const updateSize = (width: number, height: number) =>
			untrack(() => {
				const nextWidth = Math.max(0, width);
				const nextHeight = Math.max(0, height);
				if (nextWidth !== containerSize.width || nextHeight !== containerSize.height) {
					containerSize = { width: nextWidth, height: nextHeight };
				}
			});

		const initialRect = el.getBoundingClientRect();
		updateSize(initialRect.width, initialRect.height);

		if (typeof ResizeObserver === 'undefined') {
			return;
		}

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) {
				return;
			}
			updateSize(entry.contentRect.width, entry.contentRect.height);
		});

		observer.observe(el);
		return () => observer.disconnect();
	});

	// Load and parse the DZI descriptor whenever `source` or `getTileUrl` changes.
	$effect(() => {
		const currentSource = source;
		const currentGetTileUrl = getTileUrl;
		const controller = new AbortController();

		// Drop everything from the previous source, including loads already downloading,
		// so its tiles can't land in the cache and show up as fallbacks under the new image.
		sourceCounter += 1;
		loader.reset();
		cache.clear();
		opaqueTileKeys.clear();
		// Clear straight away rather than through the budget, which would leave the old image's tiles lingering.
		displayedLayers = [];
		hasPendingTileChanges = false;
		lastActiveRequestSignature = '';
		sourceId = `source-${sourceCounter}`;
		dzi = null;
		bumpCacheVersion();

		loadDzi(currentSource, {
			signal: controller.signal,
			getTileUrl: currentGetTileUrl
		})
			.then((descriptor) => {
				if (controller.signal.aborted) {
					return;
				}
				dzi = descriptor;
				onLoad?.(descriptor);
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) {
					return;
				}
				onError?.(error);
			});

		return () => {
			controller.abort();
		};
	});

	// Remap cached tile stage rectangles if stageSize or imageBounds changes after tiles are cached.
	$effect(() => {
		if (!dzi || !resolvedStage) {
			return;
		}
		const currentDzi = dzi;
		const bounds = resolvedStage.imageBounds;
		cache.remapStageRects((tile) =>
			getTileStageRect(currentDzi, tile.level, tile.col, tile.row, bounds)
		);
		bumpCacheVersion();
	});

	// Schedule optimal tile loads (plus optional single-tile base preview) only when the requested tile set changes.
	$effect(() => {
		if (!tileSelection) {
			if (lastActiveRequestSignature !== '') {
				lastActiveRequestSignature = '';
				loader.setActiveTiles([]);
			}
			return;
		}

		const requestedTiles =
			baseTileSpec && cache.get(baseTileSpec.key)?.status !== 'ready'
				? [baseTileSpec, ...tileSelection.tiles]
				: tileSelection.tiles;

		const requestSignature = requestedTiles.map((tile) => tile.key).join('|');
		if (requestSignature !== lastActiveRequestSignature) {
			lastActiveRequestSignature = requestSignature;
			loader.setActiveTiles(requestedTiles);
		}
	});

	// Evict least-recently-used tiles. Reading `renderPlan` re-runs this after every load (via `cacheVersion`),
	// so the cache stays within `maxCachedTiles` even while the viewport is still or tiles are precaching.
	$effect(() => {
		const { mountedTileKeys } = renderPlan;
		const layersOnScreen = renderedLayers;
		if (cache.size <= maxCachedTiles) {
			return;
		}
		// Protect what's planned and what's on screen: tiles waiting to be removed are still showing.
		const protectedKeys = new Set<string>([
			...mountedTileKeys,
			...layersOnScreen.flatMap((layer) => layer.tiles.map((tile) => tile.key)),
			...(tileSelection?.tiles.map((tile) => tile.key) ?? []),
			...(baseTileSpec ? [baseTileSpec.key] : [])
		]);
		cache.evict(protectedKeys);
	});

	// Expose optimal tile load status to consumers via bindable prop.
	// Not loaded until the budget has finished mounting every planned tile.
	$effect(() => {
		const nextIsOptimalLoaded = renderPlan.isOptimalLoaded && !hasPendingTileChanges;
		if (isOptimalLoaded !== nextIsOptimalLoaded) {
			isOptimalLoaded = nextIsOptimalLoaded;
		}
	});

	function getLevelTransform(levelSize: Size, origin: Point): string {
		if (!resolvedStage || levelSize.width <= 0 || levelSize.height <= 0) {
			return 'translate3d(0px, 0px, 0) scale(1, 1)';
		}

		const bounds = resolvedStage.imageBounds;
		const screenOrigin = convertStageToScreen(
			{ x: bounds.x, y: bounds.y },
			effectiveViewport,
			containerSize
		);
		const scaleX = (bounds.width * effectiveViewport.zoom) / levelSize.width;
		const scaleY = (bounds.height * effectiveViewport.zoom) / levelSize.height;
		const tx = screenOrigin.x + origin.x * scaleX;
		const ty = screenOrigin.y + origin.y * scaleY;

		return `translate3d(${tx}px, ${ty}px, 0) scale(${scaleX}, ${scaleY})`;
	}

	// --- Exported methods (see `DziViewerMethods`) ---

	/**
	 * Computes a viewport that fits `bounds` inside the current container (defaults to the loaded image's bounds).
	 */
	export function getFitViewport(bounds?: Rect, options?: ViewportFitOptions): Viewport | null {
		const targetBounds = bounds ?? resolvedStage?.imageBounds;
		return targetBounds ? computeFitViewport(targetBounds, containerSize, options) : null;
	}

	/**
	 * Computes a viewport that fills the current container with `bounds` (defaults to the loaded image's bounds).
	 */
	export function getFillViewport(bounds?: Rect, options?: ViewportFitOptions): Viewport | null {
		const targetBounds = bounds ?? resolvedStage?.imageBounds;
		return targetBounds ? computeFillViewport(targetBounds, containerSize, options) : null;
	}

	/**
	 * Pre-caches the optimal tiles for a target viewport into the viewer's shared tile cache.
	 */
	export function precacheViewport(
		targetViewport: Viewport,
		options?: PrecacheOptions
	): Promise<PrecacheResult> {
		if (!dzi || !resolvedStage || !hasContainerSize) {
			return Promise.resolve(EMPTY_PRECACHE_RESULT);
		}

		return runPrecacheViewport({
			dzi,
			imageBounds: resolvedStage.imageBounds,
			viewport: targetViewport,
			containerSize,
			loader,
			sourceId,
			dpr: options?.dpr ?? effectiveDpr,
			maxDpr: options?.maxDpr ?? maxDpr,
			quality: options?.quality ?? quality,
			signal: options?.signal
		});
	}

	/**
	 * Pre-caches the optimal tiles for a fit or fill view of `bounds` (defaults to the loaded image's bounds).
	 */
	export function precacheBounds(
		bounds: Rect | undefined,
		mode: 'fit' | 'fill',
		options?: PrecacheOptions & ViewportFitOptions
	): Promise<PrecacheResult> {
		if (!dzi || !resolvedStage || !hasContainerSize) {
			return Promise.resolve(EMPTY_PRECACHE_RESULT);
		}

		return runPrecacheBounds({
			dzi,
			imageBounds: resolvedStage.imageBounds,
			bounds: bounds ?? resolvedStage.imageBounds,
			mode,
			containerSize,
			loader,
			sourceId,
			dpr: options?.dpr ?? effectiveDpr,
			maxDpr: options?.maxDpr ?? maxDpr,
			quality: options?.quality ?? quality,
			padding: options?.padding,
			signal: options?.signal
		});
	}

	export function stageToScreen(point: Point): Point {
		return convertStageToScreen(point, effectiveViewport, containerSize);
	}

	export function screenToStage(point: Point): Point {
		return convertScreenToStage(point, effectiveViewport, containerSize);
	}

	export function pauseLoading(): void {
		loader.pause();
	}

	export function resumeLoading(): void {
		loader.resume();
	}

	export function isLoadingPaused(): boolean {
		return loader.isPaused;
	}

	export function holdResolution(): void {
		heldLevel = tileSelection?.level;
	}

	export function releaseResolution(): void {
		heldLevel = undefined;
	}

	export function isResolutionHeld(): boolean {
		return heldLevel !== undefined;
	}
</script>

<div
	bind:this={containerEl}
	class="dzi-viewport {className}"
	role={alt ? 'img' : undefined}
	aria-label={alt || undefined}
	style:--dzi-fade-duration="{tileFadeDuration}ms"
	onanimationend={handleTileAnimationEnd}
>
	{#each renderedLayers as layer (layer.level)}
		<div
			class="dzi-level"
			data-level={layer.level}
			data-optimal={layer.isOptimal ? 'true' : 'false'}
			style:z-index={layer.zIndex}
			style:transform={getLevelTransform(layer.levelSize, layer.origin)}
		>
			{#each layer.tiles as tile (tile.key)}
				<div
					class="dzi-tile"
					class:dzi-tile-fade={tileFadeDuration > 0}
					data-tile-key={tile.key}
					style:left="{tile.pixelRect.x - layer.origin.x}px"
					style:top="{tile.pixelRect.y - layer.origin.y}px"
					style:width="{tile.pixelRect.width}px"
					style:height="{tile.pixelRect.height}px"
					use:attachTileImage={{ tile, onMount: handleTileMount, onUnmount: handleTileUnmount }}
				></div>
			{/each}
		</div>
	{/each}
</div>

<style>
	.dzi-viewport {
		position: relative;
		overflow: hidden;
		width: 100%;
		height: 100%;
		contain: layout paint;
	}

	.dzi-level {
		position: absolute;
		top: 0;
		left: 0;
		transform-origin: 0 0;
		will-change: transform;
		pointer-events: none;
	}

	/*
	 * Tiles always have an explicit size, so `contain: strict` lets the browser skip re-laying-out
	 * and re-styling the rest of the viewer when one tile mounts or unmounts.
	 */
	.dzi-tile {
		position: absolute;
		overflow: hidden;
		pointer-events: none;
		user-select: none;
		contain: strict;
	}

	/*
	 * Every newly mounted tile fades in, which crossfades between zoom levels. A CSS animation starts by
	 * itself on mount and runs on the compositor, with no per-tile JS. Reduced motion keeps it: it's an
	 * opacity change, not movement. The keyframes name is global so `animationend` can match it.
	 */
	.dzi-tile-fade {
		animation: dzi-fade-in var(--dzi-fade-duration) ease-out both;
	}

	@keyframes -global-dzi-fade-in {
		from {
			opacity: 0;
		}
	}
</style>
