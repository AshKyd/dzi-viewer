import { CANCELLED_PRECACHE_RESULT, EMPTY_PRECACHE_RESULT } from './precache.js';
import { TileEngine } from './tileEngine.js';
import { createTileEngineWorker } from './tileEngineWorkerFactory.js';
import type {
	EngineFrameSync,
	EngineInboundMessage,
	EngineOutboundMessage,
	SerializableDziDescriptor,
	SerializablePrecacheBoundsOptions,
	SerializablePrecacheOptions,
	TileEngineConfig,
	TileEngineDelta
} from './tileEngineProtocol.js';
import type { TileImageLoader } from './tileLoader.js';
import type {
	DziDescriptor,
	Padding,
	PrecacheOptions,
	PrecacheResult,
	Rect,
	Size,
	Viewport,
	ViewportFitOptions
} from './types.js';

export interface TileEngineClient {
	readonly isWorker: boolean;
	sync(frame: EngineFrameSync, dziOverride?: DziDescriptor | null): void;
	precacheViewport(viewport: Viewport, options?: PrecacheOptions): Promise<PrecacheResult>;
	precacheBounds(
		bounds: Rect | undefined,
		mode: 'fit' | 'fill',
		options?: PrecacheOptions & ViewportFitOptions
	): Promise<PrecacheResult>;
	pauseLoading(reason?: string): void;
	resumeLoading(reason?: string): void;
	isLoadingPaused(): boolean;
	holdResolution(): void;
	releaseResolution(): void;
	isResolutionHeld(): boolean;
	destroy(): void;
}

export interface CreateTileEngineClientOptions {
	readonly hasCustomTileUrl?: boolean;
	readonly loadImage?: TileImageLoader;
	readonly onDelta: (delta: TileEngineDelta) => void;
}

function resolveAbsoluteUrl(url: string): string {
	if (!url || typeof location === 'undefined') {
		return url;
	}
	try {
		return new URL(url, location.href).href;
	} catch {
		return url;
	}
}

function cloneRect(rect: Rect | null): Rect | null {
	return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
}

function cloneSize(size: Size): Size {
	return { width: size.width, height: size.height };
}

function cloneViewport(viewport: Viewport): Viewport {
	return { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
}

function clonePadding(padding: Padding | undefined): Padding | undefined {
	if (padding === undefined || typeof padding === 'number') {
		return padding;
	}
	return {
		top: padding.top,
		right: padding.right,
		bottom: padding.bottom,
		left: padding.left
	};
}

function cloneConfig(config: TileEngineConfig): TileEngineConfig {
	return {
		...(config.maxDpr !== undefined ? { maxDpr: config.maxDpr } : {}),
		...(config.quality !== undefined ? { quality: config.quality } : {}),
		...(config.maxConcurrentLoads !== undefined
			? { maxConcurrentLoads: config.maxConcurrentLoads }
			: {}),
		...(config.maxCachedTiles !== undefined ? { maxCachedTiles: config.maxCachedTiles } : {}),
		...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
		...(config.failedTileRetryDelay !== undefined
			? { failedTileRetryDelay: config.failedTileRetryDelay }
			: {}),
		...(config.preloadBaseLevel !== undefined ? { preloadBaseLevel: config.preloadBaseLevel } : {}),
		...('crossOrigin' in config ? { crossOrigin: config.crossOrigin } : {})
	};
}

function serializeDzi(dzi: DziDescriptor | null): SerializableDziDescriptor | null {
	if (!dzi) {
		return null;
	}
	return {
		width: dzi.width,
		height: dzi.height,
		tileSize: dzi.tileSize,
		overlap: dzi.overlap,
		format: dzi.format,
		tilesUrl: resolveAbsoluteUrl(dzi.tilesUrl),
		...(dzi.queryParams !== undefined ? { queryParams: dzi.queryParams } : {}),
		minLevel: dzi.minLevel,
		maxLevel: dzi.maxLevel,
		...(dzi.displayRects
			? {
					displayRects: dzi.displayRects.map((rect) => ({
						x: rect.x,
						y: rect.y,
						width: rect.width,
						height: rect.height,
						minLevel: rect.minLevel,
						maxLevel: rect.maxLevel
					}))
				}
			: {})
	};
}

function serializePrecacheOptions(
	options?: PrecacheOptions
): SerializablePrecacheOptions | undefined {
	if (!options) {
		return undefined;
	}
	return {
		...(options.dpr !== undefined ? { dpr: options.dpr } : {}),
		...(options.maxDpr !== undefined ? { maxDpr: options.maxDpr } : {}),
		...(options.quality !== undefined ? { quality: options.quality } : {})
	};
}

function serializePrecacheBoundsOptions(
	options?: PrecacheOptions & ViewportFitOptions
): SerializablePrecacheBoundsOptions | undefined {
	if (!options) {
		return undefined;
	}
	const padding = clonePadding(options.padding);
	return {
		...serializePrecacheOptions(options),
		...(padding !== undefined ? { padding } : {})
	};
}

function cloneFrameSync(
	frame: EngineFrameSync,
	dziOverride?: DziDescriptor | null
): EngineFrameSync {
	return {
		...(frame.config ? { config: cloneConfig(frame.config) } : {}),
		...(frame.source
			? {
					source: {
						dzi: serializeDzi(dziOverride !== undefined ? dziOverride : frame.source.dzi),
						imageBounds: cloneRect(frame.source.imageBounds),
						sourceId: frame.source.sourceId
					}
				}
			: {}),
		...(frame.imageBounds !== undefined ? { imageBounds: cloneRect(frame.imageBounds) } : {}),
		...(frame.container
			? {
					container: {
						size: cloneSize(frame.container.size),
						deviceDpr: frame.container.deviceDpr
					}
				}
			: {}),
		...(frame.viewport ? { viewport: cloneViewport(frame.viewport) } : {}),
		...(frame.opaqueKeys ? { opaqueKeys: [...frame.opaqueKeys] } : {}),
		...(frame.clearOpaque ? { clearOpaque: true } : {})
	};
}

interface PendingPrecache {
	readonly resolve: (result: PrecacheResult) => void;
	readonly cleanupSignal: () => void;
}

class WorkerTileEngineClient implements TileEngineClient {
	readonly isWorker = true;
	readonly #worker: Worker;
	readonly #onDelta: (delta: TileEngineDelta) => void;
	readonly #pauseReasons = new Set<string>();
	readonly #pendingPrecaches = new Map<number, PendingPrecache>();

	#nextPrecacheId = 1;
	#hasDzi = false;
	#hasImageBounds = false;
	#hasContainerSize = false;
	#resolutionHeld = false;
	#destroyed = false;

	constructor(worker: Worker, onDelta: (delta: TileEngineDelta) => void) {
		this.#worker = worker;
		this.#onDelta = onDelta;
		this.#worker.onmessage = (event: MessageEvent<EngineOutboundMessage>) => {
			this.#handleMessage(event.data);
		};
	}

	sync(frame: EngineFrameSync, dziOverride?: DziDescriptor | null): void {
		if (this.#destroyed) {
			return;
		}
		if (frame.source) {
			const effectiveDzi = dziOverride !== undefined ? dziOverride : frame.source.dzi;
			this.#hasDzi = effectiveDzi !== null;
			this.#hasImageBounds = frame.source.imageBounds !== null;
			this.#resolutionHeld = false;
			this.#cancelPendingPrecaches();
		} else if (frame.imageBounds !== undefined) {
			this.#hasImageBounds = frame.imageBounds !== null;
		}
		if (frame.container) {
			this.#hasContainerSize = frame.container.size.width > 0 && frame.container.size.height > 0;
		}

		this.#post({ type: 'sync', frame: cloneFrameSync(frame, dziOverride) });
	}

	precacheViewport(viewport: Viewport, options?: PrecacheOptions): Promise<PrecacheResult> {
		if (this.#destroyed || !this.#hasDzi || !this.#hasImageBounds || !this.#hasContainerSize) {
			return Promise.resolve(EMPTY_PRECACHE_RESULT);
		}
		return this.#enqueuePrecache(options?.signal, (id) =>
			this.#post({
				type: 'precacheViewport',
				id,
				viewport: cloneViewport(viewport),
				options: serializePrecacheOptions(options)
			})
		);
	}

	precacheBounds(
		bounds: Rect | undefined,
		mode: 'fit' | 'fill',
		options?: PrecacheOptions & ViewportFitOptions
	): Promise<PrecacheResult> {
		if (this.#destroyed || !this.#hasDzi || !this.#hasImageBounds || !this.#hasContainerSize) {
			return Promise.resolve(EMPTY_PRECACHE_RESULT);
		}
		return this.#enqueuePrecache(options?.signal, (id) =>
			this.#post({
				type: 'precacheBounds',
				id,
				bounds: cloneRect(bounds ?? null) ?? undefined,
				mode,
				options: serializePrecacheBoundsOptions(options)
			})
		);
	}

	pauseLoading(reason = 'default'): void {
		this.#pauseReasons.add(reason);
		this.#post({ type: 'pauseLoading', reason });
	}

	resumeLoading(reason = 'default'): void {
		if (!this.#pauseReasons.delete(reason)) {
			return;
		}
		this.#post({ type: 'resumeLoading', reason });
	}

	isLoadingPaused(): boolean {
		return this.#pauseReasons.size > 0;
	}

	holdResolution(): void {
		if (!this.#hasDzi || !this.#hasImageBounds || !this.#hasContainerSize) {
			return;
		}
		this.#resolutionHeld = true;
		this.#post({ type: 'holdResolution' });
	}

	releaseResolution(): void {
		if (!this.#resolutionHeld) {
			return;
		}
		this.#resolutionHeld = false;
		this.#post({ type: 'releaseResolution' });
	}

	isResolutionHeld(): boolean {
		return this.#resolutionHeld;
	}

	destroy(): void {
		if (this.#destroyed) {
			return;
		}
		this.#destroyed = true;
		this.#cancelPendingPrecaches();
		this.#worker.onmessage = null;
		this.#worker.postMessage({ type: 'destroy' } satisfies EngineInboundMessage);
		this.#worker.terminate();
	}

	#post(message: EngineInboundMessage): void {
		if (this.#destroyed) {
			return;
		}
		this.#worker.postMessage(message);
	}

	#enqueuePrecache(
		signal: AbortSignal | undefined,
		send: (id: number) => void
	): Promise<PrecacheResult> {
		if (signal?.aborted) {
			return Promise.resolve(CANCELLED_PRECACHE_RESULT);
		}

		const id = this.#nextPrecacheId++;
		return new Promise((resolve) => {
			const onAbort = () => {
				const pending = this.#pendingPrecaches.get(id);
				if (!pending) {
					return;
				}
				this.#pendingPrecaches.delete(id);
				pending.cleanupSignal();
				this.#post({ type: 'abortPrecache', id });
				resolve(CANCELLED_PRECACHE_RESULT);
			};

			signal?.addEventListener('abort', onAbort, { once: true });
			this.#pendingPrecaches.set(id, {
				resolve,
				cleanupSignal: () => signal?.removeEventListener('abort', onAbort)
			});
			send(id);
		});
	}

	#cancelPendingPrecaches(): void {
		const entries = Array.from(this.#pendingPrecaches.values());
		this.#pendingPrecaches.clear();
		entries.forEach(({ resolve, cleanupSignal }) => {
			cleanupSignal();
			resolve(CANCELLED_PRECACHE_RESULT);
		});
	}

	#handleMessage(message: EngineOutboundMessage): void {
		if (this.#destroyed) {
			return;
		}
		if (message.type === 'delta') {
			this.#onDelta(message.delta);
			return;
		}
		const pending = this.#pendingPrecaches.get(message.id);
		if (!pending) {
			return;
		}
		this.#pendingPrecaches.delete(message.id);
		pending.cleanupSignal();
		pending.resolve(message.result);
	}
}

class InProcessTileEngineClient implements TileEngineClient {
	readonly isWorker = false;
	readonly #engine: TileEngine;

	constructor(onDelta: (delta: TileEngineDelta) => void, loadImage?: TileImageLoader) {
		this.#engine = new TileEngine({
			loadImage,
			// Emit synchronously in-process so unit tests driving `renderNow()` stay deterministic.
			asyncBatchMs: 0,
			onDelta
		});
	}

	sync(frame: EngineFrameSync, dziOverride?: DziDescriptor | null): void {
		this.#engine.applySync(frame, dziOverride);
	}

	precacheViewport(viewport: Viewport, options?: PrecacheOptions): Promise<PrecacheResult> {
		return this.#engine.precacheViewport(viewport, options);
	}

	precacheBounds(
		bounds: Rect | undefined,
		mode: 'fit' | 'fill',
		options?: PrecacheOptions & ViewportFitOptions
	): Promise<PrecacheResult> {
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
		this.#engine.holdResolution();
	}

	releaseResolution(): void {
		this.#engine.releaseResolution();
	}

	isResolutionHeld(): boolean {
		return this.#engine.isResolutionHeld();
	}

	destroy(): void {
		this.#engine.destroy();
	}
}

/**
 * Creates a `TileEngineClient` running all tile calculations, retention, caching, and network
 * decodes inside a Vite-inlined Web Worker, falling back transparently to an in-process
 * `TileEngine` when custom `getTileUrl` / `loadImage` is used, `Worker` is unavailable, or CSP blocks it.
 */
export function createTileEngineClient({
	hasCustomTileUrl = false,
	loadImage,
	onDelta
}: CreateTileEngineClientOptions): TileEngineClient {
	if (!hasCustomTileUrl && !loadImage && typeof Worker === 'function') {
		try {
			const worker = createTileEngineWorker();
			return new WorkerTileEngineClient(worker, onDelta);
		} catch {
			// Fall back to in-process engine when Workers are unavailable or blocked by CSP.
		}
	}
	return new InProcessTileEngineClient(onDelta, loadImage);
}
