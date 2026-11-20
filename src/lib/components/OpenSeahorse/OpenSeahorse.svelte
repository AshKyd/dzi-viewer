<script lang="ts">
	import { untrack } from 'svelte';
	import { devicePixelRatio } from 'svelte/reactivity/window';
	import { getClosestSingleTileLevel, getTileStageRect, loadDzi } from '../../dzi.js';
	import {
		EMPTY_PRECACHE_RESULT,
		precacheBounds as runPrecacheBounds,
		precacheViewport as runPrecacheViewport
	} from '../../precache.js';
	import { computeRenderPlan } from '../../retention.js';
	import { TileCache } from '../../tileCache.js';
	import { TileLoader } from '../../tileLoader.js';
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
	import type { OpenSeahorseProps } from './openSeahorseTypes.js';
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
		maxConcurrentLoads = 6,
		maxCachedTiles = 256,
		maxRetries = 1,
		failedTileRetryDelay = 5000,
		preloadBaseLevel = true,
		tileFadeDuration = 200,
		crossOrigin,
		getTileUrl,
		alt = '',
		class: className = '',
		onLoad,
		onError,
		onTileError
	}: OpenSeahorseProps = $props();

	let containerEl: HTMLDivElement | undefined = $state();
	let cacheVersion = $state(0);
	let sourceId = $state('source-0');
	let sourceCounter = 0;
	let lastActiveRequestSignature = '';

	// Deliberately not reactive: `bumpCacheVersion()` re-runs the render plan when this changes.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const opaqueTileKeys = new Set<string>();

	function bumpCacheVersion(): void {
		cacheVersion = untrack(() => cacheVersion) + 1;
	}

	function handleTileOpaque(key: string): void {
		if (opaqueTileKeys.has(key)) {
			return;
		}
		opaqueTileKeys.add(key);
		bumpCacheVersion();
	}

	function handleTileUnmount(key: string): void {
		opaqueTileKeys.delete(key);
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
			sourceId
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
			opaqueTileKeys: tileFadeDuration > 0 ? opaqueTileKeys : undefined
		});
	});

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
		};
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
		if (cache.size <= maxCachedTiles) {
			return;
		}
		const protectedKeys = new Set<string>([
			...mountedTileKeys,
			...(tileSelection?.tiles.map((tile) => tile.key) ?? []),
			...(baseTileSpec ? [baseTileSpec.key] : [])
		]);
		cache.evict(protectedKeys);
	});

	// Expose optimal tile load status to consumers via bindable prop.
	$effect(() => {
		if (isOptimalLoaded !== renderPlan.isOptimalLoaded) {
			isOptimalLoaded = renderPlan.isOptimalLoaded;
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

	// --- Exported methods (see `OpenSeahorseMethods`) ---

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
</script>

<div
	bind:this={containerEl}
	class="osh-viewport {className}"
	role={alt ? 'img' : undefined}
	aria-label={alt || undefined}
>
	{#each renderPlan.layers as layer (layer.level)}
		<div
			class="osh-level"
			data-level={layer.level}
			data-optimal={layer.isOptimal ? 'true' : 'false'}
			style:z-index={layer.zIndex}
			style:transform={getLevelTransform(layer.levelSize, layer.origin)}
		>
			{#each layer.tiles as tile (tile.key)}
				<div
					class="osh-tile"
					style:left="{tile.pixelRect.x - layer.origin.x}px"
					style:top="{tile.pixelRect.y - layer.origin.y}px"
					style:width="{tile.pixelRect.width}px"
					style:height="{tile.pixelRect.height}px"
					use:attachTileImage={{
						tile,
						fadeDuration: tileFadeDuration,
						onOpaque: handleTileOpaque,
						onUnmount: handleTileUnmount
					}}
				></div>
			{/each}
		</div>
	{/each}
</div>

<style>
	.osh-viewport {
		position: relative;
		overflow: hidden;
		width: 100%;
		height: 100%;
		contain: layout paint;
	}

	.osh-level {
		position: absolute;
		top: 0;
		left: 0;
		transform-origin: 0 0;
		will-change: transform;
		pointer-events: none;
	}

	.osh-tile {
		position: absolute;
		overflow: hidden;
		pointer-events: none;
		user-select: none;
	}
</style>
