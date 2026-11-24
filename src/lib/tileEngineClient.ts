import * as Comlink from 'comlink';
import { CANCELLED_PRECACHE_RESULT, EMPTY_PRECACHE_RESULT } from './precache.js';
import { TileEngine } from './tileEngine.js';
import { createTileEngineWorker } from './tileEngineWorkerFactory.js';
import type { TileEngineWorkerApi } from './tileEngine.worker.js';
import type { EngineFrameSync, TileEngineClient, TileEngineDelta } from './tileEngineProtocol.js';
import type { TileImageLoader } from './tileLoader.js';
import type {
	PrecacheOptions,
	PrecacheResult,
	Rect,
	Viewport,
	ViewportFitOptions
} from './types.js';
import { toCloneable } from './utils.js';

export type { TileEngineClient } from './tileEngineProtocol.js';

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

/** Plain copy of `frame` for `postMessage`, with `getTileUrl` dropped and `tilesUrl` made absolute for the worker. */
function toWorkerFrame(frame: EngineFrameSync): EngineFrameSync {
	const dzi = frame.source?.dzi;
	if (!frame.source || !dzi) {
		return toCloneable(frame);
	}
	const source = { ...frame.source, dzi: { ...dzi, tilesUrl: resolveAbsoluteUrl(dzi.tilesUrl) } };
	return toCloneable({ ...frame, source });
}

/** Precache options minus the `AbortSignal`, which can't cross into the worker. */
function toWorkerOptions<T extends PrecacheOptions>(options?: T): Omit<T, 'signal'> | undefined {
	return options && toCloneable({ ...options, signal: undefined });
}

/**
 * Main-thread proxy for a `TileEngine` running in a worker, called through Comlink.
 * Keeps a copy of the state that callers read synchronously (pause reasons, held resolution, readiness).
 */
class WorkerTileEngineClient implements TileEngineClient {
	readonly isWorker = true;
	readonly #worker: Worker;
	readonly #remote: Comlink.Remote<TileEngineWorkerApi>;
	readonly #pauseReasons = new Set<string>();
	/** Settles in-flight precaches early as cancelled, e.g. when the source changes. */
	readonly #cancelPrecache = new Map<number, () => void>();

	#nextPrecacheId = 1;
	#hasDzi = false;
	#hasImageBounds = false;
	#hasContainerSize = false;
	#resolutionHeld = false;
	#destroyed = false;

	constructor(worker: Worker, onDelta: (delta: TileEngineDelta) => void) {
		this.#worker = worker;
		this.#remote = Comlink.wrap<TileEngineWorkerApi>(worker);
		void this.#remote.init(
			Comlink.proxy((delta: TileEngineDelta) => {
				if (!this.#destroyed) {
					onDelta(delta);
				}
			})
		);
	}

	sync(frame: EngineFrameSync): void {
		if (this.#destroyed) {
			return;
		}
		if (frame.source) {
			this.#hasDzi = frame.source.dzi !== null;
			this.#hasImageBounds = frame.source.imageBounds !== null;
			this.#resolutionHeld = false;
			this.#cancelAllPrecaches();
		} else if (frame.imageBounds !== undefined) {
			this.#hasImageBounds = frame.imageBounds !== null;
		}
		if (frame.container) {
			this.#hasContainerSize = frame.container.size.width > 0 && frame.container.size.height > 0;
		}
		void this.#remote.sync(toWorkerFrame(frame));
	}

	precacheViewport(viewport: Viewport, options?: PrecacheOptions): Promise<PrecacheResult> {
		return this.#precache(options?.signal, (id) =>
			this.#remote.precacheViewport(id, toCloneable(viewport), toWorkerOptions(options))
		);
	}

	precacheBounds(
		bounds: Rect | undefined,
		mode: 'fit' | 'fill',
		options?: PrecacheOptions & ViewportFitOptions
	): Promise<PrecacheResult> {
		return this.#precache(options?.signal, (id) =>
			this.#remote.precacheBounds(id, toCloneable(bounds), mode, toWorkerOptions(options))
		);
	}

	pauseLoading(reason = 'default'): void {
		this.#pauseReasons.add(reason);
		void this.#remote.pauseLoading(reason);
	}

	resumeLoading(reason = 'default'): void {
		if (this.#pauseReasons.delete(reason)) {
			void this.#remote.resumeLoading(reason);
		}
	}

	isLoadingPaused(): boolean {
		return this.#pauseReasons.size > 0;
	}

	holdResolution(): void {
		if (!this.#isReady()) {
			return;
		}
		this.#resolutionHeld = true;
		void this.#remote.holdResolution();
	}

	releaseResolution(): void {
		if (!this.#resolutionHeld) {
			return;
		}
		this.#resolutionHeld = false;
		void this.#remote.releaseResolution();
	}

	isResolutionHeld(): boolean {
		return this.#resolutionHeld;
	}

	destroy(): void {
		if (this.#destroyed) {
			return;
		}
		this.#destroyed = true;
		this.#cancelAllPrecaches();
		this.#remote[Comlink.releaseProxy]();
		this.#worker.terminate();
	}

	/** True once the worker has a DZI, image bounds and a non-empty container. */
	#isReady(): boolean {
		return !this.#destroyed && this.#hasDzi && this.#hasImageBounds && this.#hasContainerSize;
	}

	/** Runs a worker precache that resolves as cancelled if `signal` aborts or the source changes first. */
	#precache(
		signal: AbortSignal | undefined,
		start: (id: number) => Promise<PrecacheResult>
	): Promise<PrecacheResult> {
		if (!this.#isReady()) {
			return Promise.resolve(EMPTY_PRECACHE_RESULT);
		}
		if (signal?.aborted) {
			return Promise.resolve(CANCELLED_PRECACHE_RESULT);
		}

		const id = this.#nextPrecacheId++;
		const cancelled = Promise.withResolvers<PrecacheResult>();
		const cancel = () => cancelled.resolve(CANCELLED_PRECACHE_RESULT);
		const onAbort = () => {
			void this.#remote.abortPrecache(id);
			cancel();
		};
		this.#cancelPrecache.set(id, cancel);
		signal?.addEventListener('abort', onAbort, { once: true });

		const finished = start(id).catch(() => CANCELLED_PRECACHE_RESULT);
		return Promise.race([finished, cancelled.promise]).finally(() => {
			signal?.removeEventListener('abort', onAbort);
			this.#cancelPrecache.delete(id);
		});
	}

	#cancelAllPrecaches(): void {
		this.#cancelPrecache.forEach((cancel) => cancel());
		this.#cancelPrecache.clear();
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
	// Emit synchronously in-process so unit tests driving `renderNow()` stay deterministic.
	return new TileEngine({ loadImage, asyncBatchMs: 0, onDelta });
}
