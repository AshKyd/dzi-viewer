import { CANCELLED_PRECACHE_RESULT, EMPTY_PRECACHE_RESULT } from './precache.js';
import { TileEngine } from './tileEngine.js';
import { createTileEngineWorker } from './tileEngineWorkerFactory.js';
import type {
	EngineFrameSync,
	EngineInboundMessage,
	EngineOutboundMessage,
	TileEngineClient,
	TileEngineDelta
} from './tileEngineProtocol.js';
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

	sync(frame: EngineFrameSync): void {
		if (this.#destroyed) {
			return;
		}
		if (frame.source) {
			this.#hasDzi = frame.source.dzi !== null;
			this.#hasImageBounds = frame.source.imageBounds !== null;
			this.#resolutionHeld = false;
			this.#cancelPendingPrecaches();
		} else if (frame.imageBounds !== undefined) {
			this.#hasImageBounds = frame.imageBounds !== null;
		}
		if (frame.container) {
			this.#hasContainerSize = frame.container.size.width > 0 && frame.container.size.height > 0;
		}

		this.#post({ type: 'sync', frame: toWorkerFrame(frame) });
	}

	precacheViewport(viewport: Viewport, options?: PrecacheOptions): Promise<PrecacheResult> {
		if (this.#destroyed || !this.#hasDzi || !this.#hasImageBounds || !this.#hasContainerSize) {
			return Promise.resolve(EMPTY_PRECACHE_RESULT);
		}
		return this.#enqueuePrecache(options?.signal, (id) =>
			this.#post({
				type: 'precacheViewport',
				id,
				viewport: toCloneable(viewport),
				options: toWorkerOptions(options)
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
				bounds: toCloneable(bounds),
				mode,
				options: toWorkerOptions(options)
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
