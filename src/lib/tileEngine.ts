import { getClosestSingleTileLevel, getLevelSize, getTileStageRect } from './dzi.js';
import {
	EMPTY_PRECACHE_RESULT,
	precacheBounds as runPrecacheBounds,
	precacheViewport as runPrecacheViewport
} from './precache.js';
import { computeRenderPlan, type RenderPlan } from './retention.js';
import { TileCache } from './tileCache.js';
import { DEFAULT_MAX_CONCURRENT_LOADS, TileLoader, type TileImageLoader } from './tileLoader.js';
import {
	buildSingleTileSpec,
	buildTilesForGrid,
	clampDpr,
	DEFAULT_MAX_DPR,
	getViewportTileGrid,
	type ViewportTilesResult
} from './tiling.js';
import type {
	AddedTilePayload,
	BaseTileSnapshot,
	EngineFrameSync,
	SurfaceLayer,
	TileEngineClient,
	TileEngineConfig,
	TileEngineDelta
} from './tileEngineProtocol.js';
import type {
	DziDescriptor,
	PrecacheOptions,
	PrecacheResult,
	Rect,
	Size,
	TileErrorEvent,
	TileSpec,
	Viewport,
	ViewportFitOptions
} from './types.js';
import { closeBitmap } from './utils.js';

export interface TileEngineOptions {
	readonly loadImage?: TileImageLoader;
	/** Coalescing delay (ms) for async tile completions when no `sync` arrives (`0` disables timer batching). */
	readonly asyncBatchMs?: number;
	readonly onDelta: (delta: TileEngineDelta) => void;
}

function toSurfaceLayers(plan: RenderPlan): SurfaceLayer[] {
	return plan.layers.map((layer) => ({
		level: layer.level,
		isOptimal: layer.isOptimal,
		levelSize: { width: layer.levelSize.width, height: layer.levelSize.height },
		tiles: layer.tiles.map((tile) => ({
			key: tile.key,
			pixelRect: {
				x: tile.pixelRect.x,
				y: tile.pixelRect.y,
				width: tile.pixelRect.width,
				height: tile.pixelRect.height
			}
		}))
	}));
}

function makeLayersSignature(plan: RenderPlan): string {
	return plan.layers
		.map(
			(layer) =>
				`${layer.level}:${layer.isOptimal ? 1 : 0}:${layer.tiles.map((t) => t.key).join(',')}`
		)
		.join('|');
}

/**
 * Pure tile-management engine (tiling, retention, LRU cache, fetching, decoding, precaching).
 * Runs inside a dedicated Web Worker (`tileEngine.worker.ts`) by default, or in-process as a
 * transparent fallback for custom `getTileUrl` functions, tests, or CSP-restricted environments.
 *
 * Emits only coalesced `TileEngineDelta` diffs so `postMessage` traffic stays at most once per frame.
 */
export class TileEngine implements TileEngineClient {
	readonly isWorker = false;
	readonly #onDelta: (delta: TileEngineDelta) => void;
	readonly #asyncBatchMs: number;
	readonly #cache: TileCache;
	readonly #loader: TileLoader;
	readonly #opaqueTileKeys = new Set<string>();

	readonly #pendingAdded = new Map<string, ImageBitmap>();
	readonly #pendingEvict = new Set<string>();
	readonly #pendingErrors: TileErrorEvent[] = [];
	#pendingClearAll = false;

	#dzi: DziDescriptor | null = null;
	#imageBounds: Rect | null = null;
	#sourceId = 'source-0';
	#viewport: Viewport = { x: 0, y: 0, zoom: 1 };
	#containerSize: Size = { width: 0, height: 0 };
	#deviceDpr = 1;

	#maxDpr = DEFAULT_MAX_DPR;
	#quality = 1;
	#maxCachedTiles = 256;
	#preloadBaseLevel = true;

	#heldLevel: number | undefined;
	#lastActiveRequestSignature = '';
	#lastGridSignature = '';
	#cachedSelection: ViewportTilesResult | null = null;
	#cachedPlan: RenderPlan | null = null;
	#cachedPlanGridSignature = '';
	#lastEvaluatedPlan: RenderPlan | null = null;
	#lastEvaluatedOptimalOrder: readonly string[] = [];

	#lastEmittedLayersSignature = '';
	#lastEmittedOptimalLoaded = false;
	#lastEmittedBaseTileKey = '';
	#batchTimer: ReturnType<typeof setTimeout> | undefined;
	#destroyed = false;

	constructor(options: TileEngineOptions) {
		this.#onDelta = options.onDelta;
		this.#asyncBatchMs = options.asyncBatchMs ?? 8;
		this.#cache = new TileCache({
			maxCachedTiles: this.#maxCachedTiles,
			onReady: (entry) => {
				const bitmap = entry.bitmap;
				// Detach bitmap from `TileCache` metadata: ownership transfers to the main-thread painter.
				entry.bitmap = undefined;
				if (bitmap) {
					const previous = this.#pendingAdded.get(entry.key);
					if (previous && previous !== bitmap) {
						closeBitmap(previous);
					}
					this.#pendingAdded.set(entry.key, bitmap);
				}
				this.#pendingEvict.delete(entry.key);
				this.#cachedPlan = null;
			},
			onDelete: (key) => {
				this.#opaqueTileKeys.delete(key);
				const pending = this.#pendingAdded.get(key);
				if (pending) {
					closeBitmap(pending);
					this.#pendingAdded.delete(key);
				}
				if (!this.#pendingClearAll) {
					this.#pendingEvict.add(key);
				}
				this.#cachedPlan = null;
			}
		});
		this.#loader = new TileLoader({
			cache: this.#cache,
			loadImage: options.loadImage,
			maxConcurrent: DEFAULT_MAX_CONCURRENT_LOADS,
			onChange: () => {
				this.#cachedPlan = null;
				this.#scheduleAsyncFlush();
			},
			onTileError: (event) => {
				this.#pendingErrors.push(event);
				this.#scheduleAsyncFlush();
			}
		});
	}

	/** Applies one coalesced frame sync from the main thread and immediately emits any resulting diff. */
	sync(frame: EngineFrameSync): void {
		if (this.#destroyed) {
			return;
		}
		if (frame.config) {
			this.#applyConfig(frame.config);
		}
		if (frame.source) {
			this.#applySource(frame.source.dzi, frame.source.imageBounds, frame.source.sourceId);
		} else if (frame.imageBounds !== undefined) {
			this.#applyImageBounds(frame.imageBounds);
		}
		if (frame.container) {
			this.#containerSize = frame.container.size;
			this.#deviceDpr = frame.container.deviceDpr;
		}
		if (frame.viewport) {
			this.#viewport = frame.viewport;
		}
		if (frame.clearOpaque) {
			this.#opaqueTileKeys.clear();
			this.#cachedPlan = null;
		}
		if (frame.opaqueKeys && frame.opaqueKeys.length > 0) {
			frame.opaqueKeys.forEach((key) => this.#opaqueTileKeys.add(key));
			this.#cachedPlan = null;
		}

		this.flushNow();
	}

	/** Evaluates tile selection, render plan, and LRU eviction, then emits one delta if anything changed. */
	flushNow(): void {
		if (this.#destroyed) {
			return;
		}
		this.#clearBatchTimer();
		this.#evaluate();
		this.#emitDeltaIfChanged();
	}

	precacheViewport(targetViewport: Viewport, options?: PrecacheOptions): Promise<PrecacheResult> {
		const ready = this.#readySource();
		if (!ready) {
			return Promise.resolve(EMPTY_PRECACHE_RESULT);
		}

		return runPrecacheViewport({
			...ready,
			viewport: targetViewport,
			containerSize: this.#containerSize,
			loader: this.#loader,
			sourceId: this.#sourceId,
			dpr: options?.dpr ?? this.#getSelectionDpr(),
			maxDpr: options?.maxDpr ?? this.#maxDpr,
			quality: options?.quality ?? this.#quality,
			signal: options?.signal
		});
	}

	precacheBounds(
		bounds: Rect | undefined,
		mode: 'fit' | 'fill',
		options?: PrecacheOptions & ViewportFitOptions
	): Promise<PrecacheResult> {
		const ready = this.#readySource();
		if (!ready) {
			return Promise.resolve(EMPTY_PRECACHE_RESULT);
		}

		return runPrecacheBounds({
			...ready,
			bounds: bounds ?? ready.imageBounds,
			mode,
			containerSize: this.#containerSize,
			loader: this.#loader,
			sourceId: this.#sourceId,
			dpr: options?.dpr ?? this.#getSelectionDpr(),
			maxDpr: options?.maxDpr ?? this.#maxDpr,
			quality: options?.quality ?? this.#quality,
			padding: options?.padding,
			signal: options?.signal
		});
	}

	pauseLoading(reason?: string): void {
		this.#loader.pause(reason);
	}

	resumeLoading(reason?: string): void {
		this.#loader.resume(reason);
	}

	isLoadingPaused(): boolean {
		return this.#loader.isPaused;
	}

	holdResolution(): void {
		const selection = this.#selectTiles();
		this.#heldLevel = selection?.level;
	}

	releaseResolution(): void {
		if (this.#heldLevel === undefined) {
			return;
		}
		this.#heldLevel = undefined;
		this.#cachedPlan = null;
		this.flushNow();
	}

	isResolutionHeld(): boolean {
		return this.#heldLevel !== undefined;
	}

	destroy(): void {
		if (this.#destroyed) {
			return;
		}
		this.#destroyed = true;
		this.#clearBatchTimer();
		this.#pendingAdded.forEach((bitmap) => closeBitmap(bitmap));
		this.#pendingAdded.clear();
		this.#pendingEvict.clear();
		this.#pendingErrors.length = 0;
		this.#loader.dispose();
		this.#cache.clear();
		this.#opaqueTileKeys.clear();
	}

	// --- Internals ---

	#applyConfig(config: TileEngineConfig): void {
		if (config.maxDpr !== undefined) {
			this.#maxDpr = config.maxDpr;
		}
		if (config.quality !== undefined) {
			this.#quality = config.quality;
		}
		if (config.maxCachedTiles !== undefined) {
			this.#maxCachedTiles = config.maxCachedTiles;
			this.#cache.setMaxCachedTiles(config.maxCachedTiles);
		}
		if (config.preloadBaseLevel !== undefined) {
			this.#preloadBaseLevel = config.preloadBaseLevel;
		}
		this.#loader.configure({
			maxConcurrent: config.maxConcurrentLoads,
			maxRetries: config.maxRetries,
			failedTileRetryDelay: config.failedTileRetryDelay,
			...('crossOrigin' in config ? { crossOrigin: config.crossOrigin } : {})
		});
		this.#invalidateSelectionAndPlan();
	}

	#applySource(dzi: DziDescriptor | null, imageBounds: Rect | null, sourceId: string): void {
		this.#dzi = dzi;
		this.#imageBounds = imageBounds;
		this.#sourceId = sourceId;
		this.#pendingClearAll = true;
		this.#pendingAdded.forEach((bitmap) => closeBitmap(bitmap));
		this.#pendingAdded.clear();
		this.#pendingEvict.clear();
		this.#loader.reset();
		this.#cache.clear();
		this.#opaqueTileKeys.clear();
		this.#lastActiveRequestSignature = '';
		this.#lastEmittedBaseTileKey = '';
		this.#invalidateSelectionAndPlan();
		this.#heldLevel = undefined;
	}

	#applyImageBounds(imageBounds: Rect | null): void {
		this.#imageBounds = imageBounds;
		this.#invalidateSelectionAndPlan();
		if (this.#dzi && imageBounds) {
			const currentDzi = this.#dzi;
			this.#cache.remapStageRects((tile) =>
				getTileStageRect(currentDzi, tile.level, tile.col, tile.row, imageBounds)
			);
		}
	}

	#invalidateSelectionAndPlan(): void {
		this.#lastGridSignature = '';
		this.#cachedSelection = null;
		this.#cachedPlan = null;
		this.#cachedPlanGridSignature = '';
	}

	#getSelectionDpr(): number {
		return clampDpr(this.#deviceDpr, this.#maxDpr);
	}

	/** The DZI and image bounds, or `null` until both exist and the container has a size. */
	#readySource(): { readonly dzi: DziDescriptor; readonly imageBounds: Rect } | null {
		const dzi = this.#dzi;
		const imageBounds = this.#imageBounds;
		const hasSize = this.#containerSize.width > 0 && this.#containerSize.height > 0;
		return !this.#destroyed && dzi && imageBounds && hasSize ? { dzi, imageBounds } : null;
	}

	#selectTiles(): ViewportTilesResult | null {
		const ready = this.#readySource();
		if (!ready) {
			return null;
		}
		const { dzi, imageBounds } = ready;

		const grid = getViewportTileGrid({
			dzi,
			imageBounds,
			viewport: this.#viewport,
			containerSize: this.#containerSize,
			dpr: this.#getSelectionDpr(),
			maxDpr: this.#maxDpr,
			quality: this.#quality,
			maxLevel: this.#heldLevel
		});

		const gridSignature = grid.empty
			? `${this.#sourceId}:${grid.level}:empty`
			: `${this.#sourceId}:${grid.level}:${grid.colMin},${grid.colMax},${grid.rowMin},${grid.rowMax}`;

		if (this.#cachedSelection && gridSignature === this.#lastGridSignature) {
			return {
				level: this.#cachedSelection.level,
				visibleBounds: grid.visibleBounds,
				tiles: this.#cachedSelection.tiles
			};
		}

		const result = buildTilesForGrid({
			dzi,
			imageBounds,
			viewport: this.#viewport,
			grid,
			sourceId: this.#sourceId
		});
		this.#lastGridSignature = gridSignature;
		this.#cachedSelection = result;
		return result;
	}

	#getBaseTileSpec(dzi: DziDescriptor, imageBounds: Rect): TileSpec | null {
		if (!this.#preloadBaseLevel) {
			return null;
		}
		const baseLevel = getClosestSingleTileLevel(dzi);
		const spec = buildSingleTileSpec(dzi, imageBounds, baseLevel, 0, 0, this.#sourceId);
		if (!spec) {
			return null;
		}
		return { ...spec, distanceSq: -1 };
	}

	#evaluate(): void {
		const dzi = this.#dzi;
		const imageBounds = this.#imageBounds;
		const selection = this.#selectTiles();

		if (!dzi || !imageBounds || !selection) {
			if (this.#lastActiveRequestSignature !== '') {
				this.#lastActiveRequestSignature = '';
				this.#loader.setActiveTiles([]);
			}
			this.#lastEvaluatedPlan = { layers: [], isOptimalLoaded: false, mountedTileKeys: new Set() };
			this.#lastEvaluatedOptimalOrder = [];
			return;
		}

		const canReusePlan =
			this.#cachedPlan !== null &&
			this.#cachedPlanGridSignature === this.#lastGridSignature &&
			this.#cachedPlan.isOptimalLoaded &&
			this.#cachedPlan.layers.length <= 1;

		if (canReusePlan && this.#cachedPlan) {
			this.#lastEvaluatedPlan = this.#cachedPlan;
			return;
		}

		const baseTileSpec = this.#getBaseTileSpec(dzi, imageBounds);
		const requestedTiles =
			baseTileSpec && this.#cache.get(baseTileSpec.key)?.status !== 'ready'
				? [baseTileSpec, ...selection.tiles]
				: selection.tiles;

		const requestSignature = requestedTiles.map((tile) => tile.key).join('|');
		if (requestSignature !== this.#lastActiveRequestSignature) {
			this.#lastActiveRequestSignature = requestSignature;
			this.#loader.setActiveTiles(requestedTiles);
		}

		const plan = computeRenderPlan({
			dzi,
			optimalLevel: selection.level,
			optimalTiles: selection.tiles,
			visibleBounds: selection.visibleBounds,
			cache: this.#cache,
			opaqueTileKeys: this.#opaqueTileKeys
		});

		this.#cachedPlan = plan;
		this.#cachedPlanGridSignature = this.#lastGridSignature;
		this.#lastEvaluatedPlan = plan;
		this.#lastEvaluatedOptimalOrder = selection.tiles.map((tile) => tile.key);

		if (this.#cache.size > this.#maxCachedTiles) {
			const protectedKeys = new Set<string>([
				...plan.mountedTileKeys,
				...selection.tiles.map((tile) => tile.key),
				...(baseTileSpec ? [baseTileSpec.key] : [])
			]);
			this.#cache.evict(protectedKeys);
		}
	}

	#resolveReadyBaseTile(): BaseTileSnapshot | null {
		if (!this.#dzi || !this.#imageBounds || !this.#preloadBaseLevel) {
			return null;
		}
		const baseSpec = this.#getBaseTileSpec(this.#dzi, this.#imageBounds);
		if (!baseSpec || this.#cache.get(baseSpec.key)?.status !== 'ready') {
			return null;
		}
		const levelSize = getLevelSize(this.#dzi, baseSpec.level);
		return {
			key: baseSpec.key,
			levelSize: { width: levelSize.width, height: levelSize.height },
			pixelRect: {
				x: baseSpec.pixelRect.x,
				y: baseSpec.pixelRect.y,
				width: baseSpec.pixelRect.width,
				height: baseSpec.pixelRect.height
			}
		};
	}

	#emitDeltaIfChanged(): void {
		const plan = this.#lastEvaluatedPlan;
		const nextLayersSig = plan ? makeLayersSignature(plan) : '';
		const layersChanged = nextLayersSig !== this.#lastEmittedLayersSignature;
		const nextOptimalLoaded = plan?.isOptimalLoaded ?? false;
		const optimalChanged = nextOptimalLoaded !== this.#lastEmittedOptimalLoaded;
		const readyBaseTile = this.#resolveReadyBaseTile();
		const nextBaseTileKey = readyBaseTile?.key ?? '';
		const baseTileChanged = nextBaseTileKey !== this.#lastEmittedBaseTileKey;

		const hasClear = this.#pendingClearAll;
		const hasAdded = this.#pendingAdded.size > 0;
		const hasEvict = this.#pendingEvict.size > 0;
		const hasErrors = this.#pendingErrors.length > 0;

		if (
			!hasClear &&
			!hasAdded &&
			!hasEvict &&
			!hasErrors &&
			!layersChanged &&
			!optimalChanged &&
			!baseTileChanged
		) {
			return;
		}

		const addedTiles: AddedTilePayload[] | undefined = hasAdded
			? Array.from(this.#pendingAdded.entries()).map(([key, bitmap]) => ({ key, bitmap }))
			: undefined;
		this.#pendingAdded.clear();

		const evictKeys = hasEvict ? Array.from(this.#pendingEvict) : undefined;
		this.#pendingEvict.clear();

		const tileErrors = hasErrors ? [...this.#pendingErrors] : undefined;
		this.#pendingErrors.length = 0;

		this.#pendingClearAll = false;

		if (layersChanged) {
			this.#lastEmittedLayersSignature = nextLayersSig;
		}
		if (optimalChanged) {
			this.#lastEmittedOptimalLoaded = nextOptimalLoaded;
		}
		if (baseTileChanged) {
			this.#lastEmittedBaseTileKey = nextBaseTileKey;
		}

		const delta: TileEngineDelta = {
			...(hasClear ? { clearAll: true } : {}),
			...(addedTiles ? { addedTiles } : {}),
			...(evictKeys ? { evictKeys } : {}),
			...(layersChanged && plan
				? {
						layers: toSurfaceLayers(plan),
						optimalUploadOrder: this.#lastEvaluatedOptimalOrder
					}
				: {}),
			...(baseTileChanged ? { baseTile: readyBaseTile } : {}),
			...(optimalChanged ? { isOptimalLoaded: nextOptimalLoaded } : {}),
			...(tileErrors ? { tileErrors } : {})
		};

		this.#onDelta(delta);
	}

	#scheduleAsyncFlush(): void {
		if (this.#destroyed) {
			return;
		}
		if (this.#asyncBatchMs <= 0) {
			this.flushNow();
			return;
		}
		if (this.#batchTimer !== undefined) {
			return;
		}
		this.#batchTimer = setTimeout(() => {
			this.#batchTimer = undefined;
			this.flushNow();
		}, this.#asyncBatchMs);
	}

	#clearBatchTimer(): void {
		if (this.#batchTimer !== undefined) {
			clearTimeout(this.#batchTimer);
			this.#batchTimer = undefined;
		}
	}
}
