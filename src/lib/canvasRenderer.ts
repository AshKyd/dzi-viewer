import { computeBackingSize, computeTileDrawRect } from './canvasGeometry.js';
import { EMPTY_PRECACHE_RESULT } from './precache.js';
import { createRenderSurface, type AnyCanvas, type RenderSurface } from './renderSurface.js';
import { createTileEngineClient, type TileEngineClient } from './tileEngineClient.js';
import {
	pickEngineConfig,
	type BaseTileSnapshot,
	type EngineFrameSync,
	type SurfaceLayer,
	type TileEngineConfig,
	type TileEngineDelta
} from './tileEngineProtocol.js';
import { TileFadeTracker } from './tileFade.js';
import type { TileImageLoader } from './tileLoader.js';
import { clampDpr, DEFAULT_MAX_DPR } from './tiling.js';
import type {
	DziDescriptor,
	PrecacheOptions,
	PrecacheResult,
	Rect,
	Size,
	TileErrorEvent,
	Viewport,
	ViewportFitOptions
} from './types.js';
import { closeBitmap, nowMs } from './utils.js';

/** Default per-frame time budget (ms) for uploading decoded tile bitmaps to GPU textures. */
export const DEFAULT_UPLOAD_BUDGET_MS = 4;

export type { AnyCanvas, AnyCanvas2DContext } from './renderSurface.js';

export interface CanvasRendererConfig extends TileEngineConfig {
	readonly tileFadeDuration?: number;
	/** Per-frame time budget in ms for GPU texture uploads (`Infinity` disables throttling). */
	readonly uploadBudgetMs?: number;
	readonly debug?: boolean;
}

export interface CanvasRendererCallbacks {
	readonly onOptimalLoadedChange?: (isOptimalLoaded: boolean) => void;
	readonly onTileError?: (event: TileErrorEvent) => void;
}

export interface CanvasRendererOptions extends CanvasRendererConfig {
	readonly loadImage?: TileImageLoader;
	readonly surface?: RenderSurface;
	readonly now?: () => number;
}

function isSameViewport(a: Viewport, b: Viewport): boolean {
	return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

/** Changes waiting for the next engine sync; later writes to a field replace earlier ones. */
type PendingSync = { -readonly [K in keyof EngineFrameSync]?: EngineFrameSync[K] };

/**
 * Main-thread WebGL2 / 2D canvas painter backed by an off-thread `TileEngine` Web Worker.
 *
 * All tile selection, retention, LRU caching, precaching, fetching, and decoding happen inside
 * the Worker. The main thread flushes state changes to the Worker immediately via microtask,
 * pipelines viewport painting by 1 frame in Worker mode so edge-tile updates arrive before
 * painting, uploads transferred `ImageBitmap`s within `uploadBudgetMs`, and pins the full-image
 * base tile underneath as a fallback safety net.
 */
export class CanvasTileRenderer {
	readonly #surface: RenderSurface;
	readonly #callbacks: CanvasRendererCallbacks;
	readonly #loadImage?: TileImageLoader;
	readonly #now: () => number;

	/**
	 * Decoded bitmaps received from the engine.
	 * On WebGL surfaces each bitmap is closed immediately after `uploadTile()`; on 2D surfaces
	 * bitmaps remain here until evicted or cleared.
	 */
	readonly #bitmaps = new Map<string, ImageBitmap>();
	readonly #fade = new TileFadeTracker();

	#engine: TileEngineClient;
	#layers: readonly SurfaceLayer[] = [];
	#baseTile: BaseTileSnapshot | null = null;
	#optimalUploadOrder: readonly string[] = [];
	#engineOptimalLoaded = false;

	#dzi: DziDescriptor | null = null;
	#imageBounds: Rect | null = null;
	#viewport: Viewport = { x: 0, y: 0, zoom: 1 };
	/** Viewport drawn on the canvas; trails `#viewport` by 1 frame in Worker mode so edge tiles arrive first. */
	#paintViewport: Viewport = { x: 0, y: 0, zoom: 1 };
	#queuedViewport: Viewport | null = null;
	#needsPaint = false;
	#containerSize: Size = { width: 0, height: 0 };
	#deviceDpr = 1;
	#backingWidth = 0;
	#backingHeight = 0;
	#backingScale = 1;

	#maxDpr = DEFAULT_MAX_DPR;
	#engineConfig: TileEngineConfig = {};
	#tileFadeDuration = 200;
	#uploadBudgetMs = DEFAULT_UPLOAD_BUDGET_MS;
	#debug = false;

	/** Staged changes, sent to the engine as one `sync` per frame. */
	#pendingSync: PendingSync = {};

	#lastReportedOptimalLoaded = false;
	#lastUploadNowMs = Number.NEGATIVE_INFINITY;
	#frameId: number | ReturnType<typeof setTimeout> | undefined;
	#frameIsRaf = false;
	#syncMicrotaskPending = false;
	#inRunFrame = false;
	#destroyed = false;

	constructor(
		canvas: AnyCanvas,
		callbacks: CanvasRendererCallbacks = {},
		options: CanvasRendererOptions = {}
	) {
		this.#surface = options.surface ?? createRenderSurface(canvas);
		this.#callbacks = callbacks;
		this.#loadImage = options.loadImage;
		this.#now = options.now ?? nowMs;
		this.#engine = createTileEngineClient({
			loadImage: options.loadImage,
			onDelta: (delta) => this.#applyEngineDelta(delta)
		});
		this.configure(options);
	}

	configure(config: CanvasRendererConfig): void {
		if (this.#destroyed) {
			return;
		}
		if (config.maxDpr !== undefined) {
			this.#maxDpr = config.maxDpr;
		}
		if (config.tileFadeDuration !== undefined) {
			this.#tileFadeDuration = config.tileFadeDuration;
			if (this.#tileFadeDuration <= 0) {
				this.#fade.clear();
				this.#pendingSync.clearOpaque = true;
			}
		}
		if (config.uploadBudgetMs !== undefined) {
			this.#uploadBudgetMs = Math.max(0, config.uploadBudgetMs);
		}
		if (config.debug !== undefined) {
			this.#debug = config.debug;
		}

		const nextEngineConfig = pickEngineConfig(config);
		if (Object.keys(nextEngineConfig).length > 0) {
			this.#engineConfig = { ...this.#engineConfig, ...nextEngineConfig };
			this.#pendingSync.config = { ...this.#pendingSync.config, ...nextEngineConfig };
		}

		this.#syncBackingSize();
		this.#needsPaint = true;
		this.#scheduleSyncAndFrame();
	}

	setSource(dzi: DziDescriptor | null, imageBounds: Rect | null, sourceId: string): void {
		if (this.#destroyed) {
			return;
		}

		// Custom `getTileUrl` functions cannot cross `postMessage`, so switch to in-process if needed.
		if (dzi?.getTileUrl && this.#engine.isWorker) {
			this.#switchToInProcessEngine();
		}

		this.#dzi = dzi;
		this.#imageBounds = imageBounds;
		this.#paintViewport = this.#viewport;
		this.#queuedViewport = null;
		this.#clearLocalTiles();
		this.#engineOptimalLoaded = false;
		this.#reportOptimalLoaded(false);

		// A new source resets the engine, so older bounds or opaque changes no longer apply.
		delete this.#pendingSync.imageBounds;
		delete this.#pendingSync.clearOpaque;
		this.#pendingSync.source = { dzi, imageBounds, sourceId };

		if (!dzi) {
			this.#needsPaint = false;
			this.#flushSyncToEngine();
			this.#clearCanvas();
			return;
		}
		this.#needsPaint = true;
		this.#scheduleSyncAndFrame();
	}

	setImageBounds(imageBounds: Rect | null): void {
		if (this.#destroyed) {
			return;
		}
		this.#imageBounds = imageBounds;
		const pendingSource = this.#pendingSync.source;
		if (pendingSource) {
			this.#pendingSync.source = { ...pendingSource, imageBounds };
		} else {
			this.#pendingSync.imageBounds = imageBounds;
		}
		this.#needsPaint = true;
		this.#scheduleSyncAndFrame();
	}

	setViewport(viewport: Viewport): void {
		if (this.#destroyed) {
			return;
		}
		if (isSameViewport(viewport, this.#viewport)) {
			return;
		}
		this.#viewport = viewport;
		this.#pendingSync.viewport = viewport;
		this.#scheduleSyncAndFrame();
	}

	setContainerSize(size: Size, deviceDpr: number): void {
		if (this.#destroyed) {
			return;
		}
		const changed =
			size.width !== this.#containerSize.width ||
			size.height !== this.#containerSize.height ||
			deviceDpr !== this.#deviceDpr;
		if (!changed) {
			return;
		}
		this.#containerSize = size;
		this.#deviceDpr = deviceDpr;
		this.#pendingSync.container = { size, deviceDpr };
		this.#needsPaint = true;
		this.#syncBackingSize();
		this.#scheduleSyncAndFrame();
	}

	precacheViewport(targetViewport: Viewport, options?: PrecacheOptions): Promise<PrecacheResult> {
		if (!this.#readySource()) {
			return Promise.resolve(EMPTY_PRECACHE_RESULT);
		}
		this.#flushSyncToEngine();
		return this.#engine.precacheViewport(targetViewport, options);
	}

	precacheBounds(
		bounds: Rect | undefined,
		mode: 'fit' | 'fill',
		options?: PrecacheOptions & ViewportFitOptions
	): Promise<PrecacheResult> {
		if (!this.#readySource()) {
			return Promise.resolve(EMPTY_PRECACHE_RESULT);
		}
		this.#flushSyncToEngine();
		return this.#engine.precacheBounds(bounds, mode, options);
	}

	pauseLoading(reason?: string): void {
		this.#engine.pauseLoading(reason);
	}

	resumeLoading(reason?: string): void {
		this.#engine.resumeLoading(reason);
	}

	isLoadingPaused(): boolean {
		return this.#engine.isLoadingPaused();
	}

	holdResolution(): void {
		this.#flushSyncToEngine();
		this.#engine.holdResolution();
	}

	releaseResolution(): void {
		this.#engine.releaseResolution();
	}

	isResolutionHeld(): boolean {
		return this.#engine.isResolutionHeld();
	}

	scheduleRender(): void {
		if (this.#destroyed || this.#frameId !== undefined) {
			return;
		}

		const tick = () => {
			this.#frameId = undefined;
			this.#frameIsRaf = false;
			if (this.#destroyed) {
				return;
			}
			this.#runFrame(this.#now());
		};

		if (typeof requestAnimationFrame === 'function') {
			this.#frameIsRaf = true;
			this.#frameId = requestAnimationFrame(tick);
			return;
		}

		this.#frameIsRaf = false;
		this.#frameId = setTimeout(tick, 0);
	}

	/** Executes one sync, budgeted GPU upload, and canvas draw pass immediately. */
	renderNow(now = this.#now()): void {
		this.#runFrame(now, true);
	}

	destroy(): void {
		if (this.#destroyed) {
			return;
		}
		this.#destroyed = true;
		this.#cancelScheduledRender();
		this.#engine.destroy();
		this.#clearLocalTiles();
		this.#surface.destroy();
	}

	// --- Internals ---

	/** The DZI and image bounds, or `null` until both exist and the container has a size. */
	#readySource(): { readonly dzi: DziDescriptor; readonly imageBounds: Rect } | null {
		const dzi = this.#dzi;
		const imageBounds = this.#imageBounds;
		const hasSize = this.#containerSize.width > 0 && this.#containerSize.height > 0;
		return !this.#destroyed && dzi && imageBounds && hasSize ? { dzi, imageBounds } : null;
	}

	#runFrame(now: number, immediate = false): void {
		if (this.#destroyed) {
			return;
		}
		this.#cancelScheduledRender();

		// Flush any staged viewport/config/source/opaque changes to the engine once per frame.
		this.#inRunFrame = true;
		try {
			this.#flushSyncToEngine();
		} finally {
			this.#inRunFrame = false;
		}

		const ready = this.#readySource();
		if (!ready) {
			this.#paintViewport = this.#viewport;
			this.#queuedViewport = null;
			this.#needsPaint = false;
			this.#reportOptimalLoaded(false);
			this.#clearCanvas();
			return;
		}

		let hasDeferredViewport = false;
		if (!this.#engine.isWorker || immediate) {
			if (!isSameViewport(this.#paintViewport, this.#viewport) || immediate) {
				this.#paintViewport = this.#viewport;
				this.#needsPaint = true;
			}
			this.#queuedViewport = null;
		} else {
			// Pipeline viewport painting by 1 frame in Worker mode so the Worker gets a full frame
			// interval to reply with updated edge tiles before that viewport is drawn.
			if (this.#queuedViewport !== null) {
				this.#paintViewport = this.#queuedViewport;
				this.#queuedViewport = null;
				this.#needsPaint = true;
			}
			if (!isSameViewport(this.#viewport, this.#paintViewport)) {
				this.#queuedViewport = this.#viewport;
				hasDeferredViewport = true;
			}
		}

		const { uploaded, hasPending: hasPendingUploads } = this.#uploadPendingTiles(now);
		if (uploaded > 0) {
			this.#needsPaint = true;
		}

		let needsAnotherFrame = false;
		if (this.#needsPaint) {
			this.#needsPaint = false;
			const useFades = this.#tileFadeDuration > 0;
			needsAnotherFrame = this.#drawLayers(ready.dzi, ready.imageBounds, now, useFades);
			if (needsAnotherFrame) {
				this.#needsPaint = true;
			}
		}

		this.#reportOptimalLoaded(this.#engineOptimalLoaded && !hasPendingUploads);

		if (needsAnotherFrame || hasPendingUploads || hasDeferredViewport) {
			this.scheduleRender();
		}
	}

	#flushSyncToEngine(): void {
		const opaqueKeys = this.#fade.takeNewlyOpaque();
		const frame: EngineFrameSync = {
			...this.#pendingSync,
			...(opaqueKeys.length > 0 ? { opaqueKeys } : {})
		};
		this.#pendingSync = {};
		if (Object.keys(frame).length > 0) {
			this.#engine.sync(frame);
		}
	}

	#applyEngineDelta(delta: TileEngineDelta): void {
		if (this.#destroyed) {
			delta.addedTiles?.forEach((item) => closeBitmap(item.bitmap));
			return;
		}

		if (delta.clearAll) {
			this.#clearLocalTiles();
		}

		if (delta.evictKeys && delta.evictKeys.length > 0) {
			delta.evictKeys.forEach((key) => {
				closeBitmap(this.#bitmaps.get(key));
				this.#bitmaps.delete(key);
				this.#fade.forget(key);
				this.#surface.evictTile(key);
			});
		}

		if (delta.addedTiles && delta.addedTiles.length > 0) {
			delta.addedTiles.forEach(({ key, bitmap }) => {
				const previous = this.#bitmaps.get(key);
				if (previous && previous !== bitmap) {
					closeBitmap(previous);
				}
				this.#bitmaps.set(key, bitmap);
				this.#fade.restartFade(key);
			});
		}

		if (delta.layers !== undefined) {
			this.#layers = delta.layers;
		}

		if (delta.baseTile !== undefined) {
			this.#baseTile = delta.baseTile;
		}

		if (delta.optimalUploadOrder !== undefined) {
			this.#optimalUploadOrder = delta.optimalUploadOrder;
		}

		if (delta.isOptimalLoaded !== undefined) {
			this.#engineOptimalLoaded = delta.isOptimalLoaded;
		}

		if (delta.tileErrors && delta.tileErrors.length > 0) {
			delta.tileErrors.forEach((event) => this.#callbacks.onTileError?.(event));
		}

		// Schedule a draw on the next animation frame when asynchronous worker updates arrive.
		if (
			delta.clearAll ||
			delta.addedTiles ||
			delta.layers ||
			delta.baseTile !== undefined ||
			delta.evictKeys
		) {
			this.#needsPaint = true;
			if (!this.#inRunFrame) {
				this.scheduleRender();
			}
		}
	}

	#switchToInProcessEngine(): void {
		this.#engine.destroy();
		this.#engine = createTileEngineClient({
			hasCustomTileUrl: true,
			loadImage: this.#loadImage,
			onDelta: (delta) => this.#applyEngineDelta(delta)
		});
		// The new engine starts empty, so resend everything it needs besides the source.
		this.#pendingSync = {
			...this.#pendingSync,
			config: { ...this.#engineConfig },
			container: { size: this.#containerSize, deviceDpr: this.#deviceDpr },
			viewport: this.#viewport
		};
	}

	#clearLocalTiles(): void {
		this.#bitmaps.forEach((bitmap) => closeBitmap(bitmap));
		this.#bitmaps.clear();
		this.#fade.clear();
		this.#layers = [];
		this.#baseTile = null;
		this.#optimalUploadOrder = [];
		this.#surface.clearTiles();
	}

	/**
	 * Sends staged state changes to the Worker immediately in a microtask while deferring the
	 * WebGL paint to the next `requestAnimationFrame`. That gives the Worker the full frame
	 * interval to reply with updated edge tiles before we paint, avoiding blank edge flashes.
	 */
	#scheduleSyncAndFrame(): void {
		if (this.#destroyed) {
			return;
		}
		if (this.#engine.isWorker && !this.#syncMicrotaskPending) {
			this.#syncMicrotaskPending = true;
			queueMicrotask(() => {
				if (!this.#syncMicrotaskPending || this.#destroyed) {
					return;
				}
				this.#syncMicrotaskPending = false;
				this.#flushSyncToEngine();
			});
		}
		this.scheduleRender();
	}

	#cancelScheduledRender(): void {
		this.#syncMicrotaskPending = false;
		if (this.#frameId === undefined) {
			return;
		}
		if (this.#frameIsRaf && typeof cancelAnimationFrame === 'function') {
			cancelAnimationFrame(this.#frameId as number);
		} else {
			clearTimeout(this.#frameId);
		}
		this.#frameId = undefined;
		this.#frameIsRaf = false;
	}

	/** Keep backing store crisp on Retina displays (up to 2×) even when tile selection uses `maxDpr = 1`. */
	#getBackingDpr(): number {
		return clampDpr(this.#deviceDpr, Math.max(2, this.#maxDpr));
	}

	#syncBackingSize(): void {
		const next = computeBackingSize(this.#containerSize, this.#getBackingDpr());
		this.#backingScale = next.scale;
		if (next.width <= 0 || next.height <= 0) {
			return;
		}
		if (this.#backingWidth !== next.width || this.#backingHeight !== next.height) {
			this.#backingWidth = next.width;
			this.#backingHeight = next.height;
			this.#surface.resize(next.width, next.height);
		}
	}

	#clearCanvas(): void {
		if (this.#backingWidth <= 0 || this.#backingHeight <= 0) {
			return;
		}
		this.#surface.clear();
	}

	/**
	 * Uploads newly decoded tile bitmaps to GPU textures within `#uploadBudgetMs` per frame so a
	 * burst of concurrent decodes never stalls a frame with back-to-back `texImage2D` calls.
	 * On WebGL surfaces each `ImageBitmap` is closed right after upload so CPU RAM isn't duplicated.
	 */
	#uploadPendingTiles(now: number): { readonly uploaded: number; readonly hasPending: boolean } {
		const baseKey =
			this.#engine.isWorker &&
			this.#baseTile &&
			this.#bitmaps.has(this.#baseTile.key) &&
			!this.#surface.hasTile(this.#baseTile.key)
				? this.#baseTile.key
				: undefined;

		const fallbackKeys = this.#layers
			.filter((layer) => !layer.isOptimal)
			.flatMap((layer) => layer.tiles)
			.map((tile) => tile.key)
			.filter((key) => key !== baseKey && this.#bitmaps.has(key) && !this.#surface.hasTile(key));

		const optimalLayer = this.#layers.find((layer) => layer.isOptimal);
		const optimalKeySet = new Set((optimalLayer?.tiles ?? []).map((tile) => tile.key));
		const orderedOptimalKeys = this.#optimalUploadOrder.filter(
			(key) =>
				key !== baseKey &&
				optimalKeySet.has(key) &&
				this.#bitmaps.has(key) &&
				!this.#surface.hasTile(key)
		);

		const pendingKeys = [...(baseKey ? [baseKey] : []), ...fallbackKeys, ...orderedOptimalKeys];
		if (pendingKeys.length === 0) {
			return { uploaded: 0, hasPending: false };
		}

		// Never upload twice inside the same vsync tick (e.g. scroll + rAF firing within 1-2ms).
		if (now - this.#lastUploadNowMs < 6) {
			return { uploaded: 0, hasPending: true };
		}
		this.#lastUploadNowMs = now;

		const start = this.#now();
		let uploaded = 0;

		const hasPending = pendingKeys.some((key) => {
			if (uploaded > 0 && this.#now() - start >= this.#uploadBudgetMs) {
				return true;
			}
			const bitmap = this.#bitmaps.get(key);
			if (bitmap) {
				this.#surface.uploadTile(key, bitmap);
				if (this.#surface.kind === 'webgl') {
					closeBitmap(bitmap);
					this.#bitmaps.delete(key);
				}
				uploaded += 1;
			}
			return false;
		});

		return { uploaded, hasPending };
	}

	#canDrawTile(key: string): boolean {
		return this.#surface.kind === 'webgl' ? this.#surface.hasTile(key) : this.#bitmaps.has(key);
	}

	#drawLayers(dzi: DziDescriptor, imageBounds: Rect, now: number, useFades: boolean): boolean {
		if (this.#backingWidth <= 0 || this.#backingHeight <= 0) {
			return false;
		}

		this.#surface.beginFrame();

		const snapEdges = dzi.overlap === 0;
		const debugRects: Rect[] = [];
		let needsAnotherFrame = false;

		// In Worker mode, pin the single-tile full-image base preview underneath when it isn't already
		// in `#layers`, so even a fast pan/zoom before the Worker replies never exposes white edges.
		const baseTile = this.#engine.isWorker ? this.#baseTile : null;
		const baseAlreadyInLayers =
			baseTile !== null &&
			this.#layers.some((layer) => layer.tiles.some((tile) => tile.key === baseTile.key));
		if (baseTile && !baseAlreadyInLayers && this.#canDrawTile(baseTile.key)) {
			const baseRect = computeTileDrawRect({
				tile: baseTile,
				layer: baseTile,
				imageBounds,
				viewport: this.#paintViewport,
				containerSize: this.#containerSize,
				backingScale: this.#backingScale,
				snapEdges
			});
			if (baseRect.width > 0 && baseRect.height > 0) {
				this.#surface.drawTile(baseTile.key, this.#bitmaps.get(baseTile.key), baseRect, 1);
			}
		}

		this.#layers.forEach((layer) => {
			layer.tiles.forEach((tile) => {
				if (!this.#canDrawTile(tile.key)) {
					return;
				}

				const rect = computeTileDrawRect({
					tile,
					layer,
					imageBounds,
					viewport: this.#paintViewport,
					containerSize: this.#containerSize,
					backingScale: this.#backingScale,
					snapEdges
				});

				if (rect.width <= 0 || rect.height <= 0) {
					return;
				}

				let alpha = 1;
				if (!layer.isOptimal || !useFades) {
					// Fallback placeholders (and all tiles when fading is disabled) draw at full opacity
					// immediately. When a newly opaque optimal tile finishes covering fallbacks, notify
					// the engine on the next frame so the covered fallback layer is dropped.
					const becameOpaque = this.#fade.markOpaque(tile.key);
					if (becameOpaque && layer.isOptimal && this.#layers.length > 1) {
						needsAnotherFrame = true;
					}
				} else if (!this.#fade.isOpaque(tile.key)) {
					alpha = this.#fade.alphaAt(tile.key, now, this.#tileFadeDuration);
					if (alpha >= 1) {
						this.#fade.markOpaque(tile.key);
					}
					// Keep animating the fade, or run one more frame so the engine drops fallbacks it now covers.
					needsAnotherFrame = true;
				}

				this.#surface.drawTile(tile.key, this.#bitmaps.get(tile.key), rect, alpha);
				if (this.#debug) {
					debugRects.push(rect);
				}
			});
		});

		// Draw debug outlines in a separate pass after all tiles so WebGL sprite batching stays unbroken.
		if (debugRects.length > 0) {
			const lineWidth = Math.max(1, Math.round(this.#backingScale));
			debugRects.forEach((rect) => this.#surface.drawDebugOutline(rect, lineWidth));
		}

		this.#surface.endFrame();
		return needsAnotherFrame;
	}

	#reportOptimalLoaded(next: boolean): void {
		if (this.#lastReportedOptimalLoaded === next) {
			return;
		}
		this.#lastReportedOptimalLoaded = next;
		this.#callbacks.onOptimalLoadedChange?.(next);
	}
}
