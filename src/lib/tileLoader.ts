import type { TileCache } from './tileCache.js';
import type { PrecacheResult, TileErrorEvent, TileSpec } from './types.js';

export type TilePriority = 'active' | 'precache';

type CrossOrigin = '' | 'anonymous' | 'use-credentials';

export type TileImageLoader = (
	url: string,
	options: {
		readonly priority: TilePriority;
		readonly crossOrigin?: CrossOrigin;
	}
) => Promise<HTMLImageElement | undefined>;

export interface TileLoaderOptions {
	readonly cache: TileCache;
	readonly maxConcurrent?: number;
	readonly maxRetries?: number;
	/** Base delay in ms before a still-visible failed tile is retried. Doubles per failure, capped at 60s. */
	readonly failedTileRetryDelay?: number;
	readonly crossOrigin?: CrossOrigin;
	readonly loadImage?: TileImageLoader;
	readonly onChange?: () => void;
	readonly onTileError?: (event: TileErrorEvent) => void;
}

export type TileLoaderConfig = Omit<TileLoaderOptions, 'cache' | 'loadImage'>;

/** How a tile load ended, as reported to precache waiters. */
type TileOutcome = 'loaded' | 'failed' | 'cancelled';

interface QueuedTask {
	spec: TileSpec;
	active: boolean;
	precache: boolean;
	distanceSq: number;
}

/**
 * Default number of tile loads in flight at once.
 *
 * HTTP/1.1 browsers cap a host at ~6 connections, which is why 6 used to be the norm. Over HTTP/2 or
 * HTTP/3 every request shares one multiplexed connection, so more parallel requests cut latency for a
 * full viewport of small tiles. It is not unlimited because loads can't be cancelled once started:
 * keeping the rest in our own queue lets panning drop and reprioritise them.
 * On an HTTP/1.1 host the browser simply queues the extra requests, so this is safe there too.
 */
export const DEFAULT_MAX_CONCURRENT_LOADS = 16;

const DEFAULT_FAILED_TILE_RETRY_DELAY = 5000;
const MAX_FAILED_TILE_RETRY_DELAY = 60_000;

function defaultLoadImage(
	url: string,
	options: { readonly priority: TilePriority; readonly crossOrigin?: CrossOrigin }
): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.decoding = 'async';
		img.draggable = false;
		img.alt = '';

		if (options.crossOrigin !== undefined) {
			img.crossOrigin = options.crossOrigin;
		}

		if ('fetchPriority' in img) {
			img.fetchPriority = options.priority === 'active' ? 'high' : 'low';
		}

		const cleanup = () => {
			img.removeEventListener('load', handleLoad);
			img.removeEventListener('error', handleError);
		};

		const handleLoad = () => {
			cleanup();
			// Wait for bitmap decode before revealing so swapping tiles never causes a blank flash.
			if (typeof img.decode !== 'function') {
				resolve(img);
				return;
			}
			img
				.decode()
				.then(() => resolve(img))
				.catch((decodeError: unknown) => {
					if (img.complete && img.naturalWidth > 0) {
						resolve(img);
						return;
					}
					reject(decodeError instanceof Error ? decodeError : new Error(String(decodeError)));
				});
		};

		const handleError = () => {
			cleanup();
			reject(new Error(`Failed to load tile image: ${url}`));
		};

		img.addEventListener('load', handleLoad);
		img.addEventListener('error', handleError);
		img.src = url;
	});
}

/**
 * Concurrency-limited tile loader with active-first prioritisation, viewport-change cancellation,
 * decode-before-swap readiness, and retry support.
 *
 * Loads can't be aborted once started, so `reset()` bumps a generation counter instead: any load that
 * started in an earlier generation settles silently without touching the cache or firing callbacks.
 */
export class TileLoader {
	readonly #cache: TileCache;
	readonly #loadImage: TileImageLoader;
	readonly #queue = new Map<string, QueuedTask>();
	/** Key → generation of loads currently running for the current or an earlier generation. */
	readonly #inFlight = new Map<string, number>();
	readonly #waiters = new Map<string, Set<(outcome: TileOutcome) => void>>();
	/** Latest spec for every tile in the active viewport set, used to retry failed tiles. */
	readonly #activeSpecs = new Map<string, TileSpec>();
	readonly #failureCounts = new Map<string, number>();
	readonly #retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

	#inFlightCount = 0;
	#generation = 0;
	#maxConcurrent = DEFAULT_MAX_CONCURRENT_LOADS;
	#maxRetries = 1;
	#failedTileRetryDelay = DEFAULT_FAILED_TILE_RETRY_DELAY;
	#crossOrigin?: CrossOrigin;
	#onChange?: () => void;
	#onTileError?: (event: TileErrorEvent) => void;
	#disposed = false;
	#paused = false;

	constructor({ cache, loadImage = defaultLoadImage, ...config }: TileLoaderOptions) {
		this.#cache = cache;
		this.#loadImage = loadImage;
		this.configure(config);
	}

	/** Updates only the options present in `config`, then starts any loads that now have a free slot. */
	configure(config: TileLoaderConfig): void {
		if (config.maxConcurrent !== undefined) {
			this.#maxConcurrent = Math.max(1, config.maxConcurrent);
		}
		if (config.maxRetries !== undefined) {
			this.#maxRetries = Math.max(0, config.maxRetries);
		}
		if (config.failedTileRetryDelay !== undefined) {
			this.#failedTileRetryDelay = Math.max(0, config.failedTileRetryDelay);
		}
		// `crossOrigin: undefined` is meaningful (no CORS attribute), so check for the key, not the value.
		if ('crossOrigin' in config) {
			this.#crossOrigin = config.crossOrigin;
		}
		if ('onChange' in config) {
			this.#onChange = config.onChange;
		}
		if ('onTileError' in config) {
			this.#onTileError = config.onTileError;
		}
		this.#pump();
	}

	// --- Public API ---

	/**
	 * Sets the active viewport tile list. Drops queued active-only tiles no longer in the list
	 * and upgrades any matching queued precache tiles to active priority.
	 */
	setActiveTiles(tiles: readonly TileSpec[]): void {
		if (this.#disposed) {
			return;
		}

		const nextActiveSpecs = new Map(tiles.map((spec) => [spec.key, spec]));

		// Tiles that left the viewport: stop retry timers and drop queued loads nobody else wants.
		Array.from(this.#activeSpecs.keys())
			.filter((key) => !nextActiveSpecs.has(key))
			.forEach((key) => this.#clearRetryTimer(key));

		Array.from(this.#queue.entries())
			.filter(([key]) => !nextActiveSpecs.has(key))
			.forEach(([key, task]) => {
				task.active = false;
				if (!task.precache) {
					this.#queue.delete(key);
				}
			});

		this.#activeSpecs.clear();
		nextActiveSpecs.forEach((spec, key) => this.#activeSpecs.set(key, spec));

		nextActiveSpecs.forEach((spec) => {
			const cached = this.#cache.get(spec.key);
			if (cached?.status === 'ready') {
				this.#cache.touch(spec.key);
				return;
			}
			// Failed tiles are retried on a backoff timer, not every time the viewport moves.
			if (cached?.status === 'error') {
				this.#scheduleRetry(spec.key);
				return;
			}
			this.#enqueueActive(spec);
		});

		this.#pump();
	}

	/**
	 * Enqueues tiles at precache priority (loaded only after active viewport tiles) and resolves
	 * when all tiles settle or when `signal` aborts.
	 */
	precacheTiles(tiles: readonly TileSpec[], signal?: AbortSignal): Promise<PrecacheResult> {
		// The same key listed twice would register two waiters but count as one load.
		const uniqueTiles = Array.from(new Map(tiles.map((spec) => [spec.key, spec])).values());
		const total = uniqueTiles.length;

		if (total === 0 || this.#disposed || signal?.aborted) {
			return Promise.resolve({
				total,
				loaded: 0,
				failed: 0,
				cancelled: this.#disposed || Boolean(signal?.aborted)
			});
		}

		return new Promise((resolve) => {
			let loaded = 0;
			let failed = 0;
			let settled = false;
			const pendingWaiters = new Map<string, (outcome: TileOutcome) => void>();

			const finish = (cancelled: boolean) => {
				if (settled) {
					return;
				}
				settled = true;
				signal?.removeEventListener('abort', handleAbort);
				pendingWaiters.forEach((callback, key) => this.#removeWaiter(key, callback));
				pendingWaiters.clear();
				resolve({ total, loaded, failed, cancelled });
			};

			const handleAbort = () => finish(true);
			signal?.addEventListener('abort', handleAbort, { once: true });

			uniqueTiles.forEach((spec) => {
				if (this.#cache.get(spec.key)?.status === 'ready') {
					this.#cache.touch(spec.key);
					loaded += 1;
					return;
				}

				const onTileSettled = (outcome: TileOutcome) => {
					pendingWaiters.delete(spec.key);
					if (outcome === 'cancelled') {
						finish(true);
						return;
					}
					loaded += outcome === 'loaded' ? 1 : 0;
					failed += outcome === 'failed' ? 1 : 0;
					if (loaded + failed >= total) {
						finish(false);
					}
				};

				pendingWaiters.set(spec.key, onTileSettled);
				const waiterSet = this.#waiters.get(spec.key) ?? new Set();
				waiterSet.add(onTileSettled);
				this.#waiters.set(spec.key, waiterSet);

				if (this.#isLoadingNow(spec.key)) {
					return;
				}

				const existingTask = this.#queue.get(spec.key);
				if (existingTask) {
					existingTask.precache = true;
					return;
				}

				this.#queue.set(spec.key, {
					spec,
					active: false,
					precache: true,
					distanceSq: spec.distanceSq
				});
			});

			if (loaded + failed >= total) {
				finish(false);
				return;
			}

			this.#pump();
		});
	}

	/**
	 * Forgets all queued work, retry timers and waiters (pending precaches resolve as cancelled).
	 * Loads already running finish in the background but their results are discarded.
	 */
	reset(): void {
		this.#generation += 1;
		this.#queue.clear();
		this.#activeSpecs.clear();
		this.#failureCounts.clear();
		Array.from(this.#retryTimers.keys()).forEach((key) => this.#clearRetryTimer(key));

		// Discarded loads will never reach `ready`, so drop their `loading` entries (which are never evicted).
		this.#inFlight.forEach((_, key) => {
			if (this.#cache.get(key)?.status === 'loading') {
				this.#cache.delete(key);
			}
		});
		this.#inFlight.clear();

		const waiterSets = Array.from(this.#waiters.values());
		this.#waiters.clear();
		waiterSets.forEach((waiterSet) => waiterSet.forEach((callback) => callback('cancelled')));
	}

	dispose(): void {
		this.reset();
		this.#disposed = true;
	}

	// --- Pause / resume ---

	/**
	 * Stops starting new viewport tile loads, e.g. during an animation where intermediate viewports
	 * are only on screen for a frame. While paused:
	 * - `setActiveTiles()` still updates the queue, so tiles that leave the view are dropped and
	 *   `resume()` only loads what the final viewport needs.
	 * - Precache loads keep running, so a destination can be warmed up while the animation plays.
	 * - Loads already in flight finish normally.
	 */
	pause(): void {
		this.#paused = true;
	}

	/** Starts loading queued viewport tiles again. */
	resume(): void {
		if (!this.#paused) {
			return;
		}
		this.#paused = false;
		this.#pump();
	}

	get isPaused(): boolean {
		return this.#paused;
	}

	// --- Queue ---

	#isLoadingNow(key: string): boolean {
		return this.#inFlight.get(key) === this.#generation;
	}

	#enqueueActive(spec: TileSpec): void {
		if (this.#isLoadingNow(spec.key)) {
			return;
		}

		const existingTask = this.#queue.get(spec.key);
		if (existingTask) {
			existingTask.active = true;
			existingTask.spec = spec;
			existingTask.distanceSq = spec.distanceSq;
			return;
		}

		this.#queue.set(spec.key, { spec, active: true, precache: false, distanceSq: spec.distanceSq });
	}

	#removeWaiter(key: string, callback: (outcome: TileOutcome) => void): void {
		const waiterSet = this.#waiters.get(key);
		if (!waiterSet) {
			return;
		}
		waiterSet.delete(callback);
		if (waiterSet.size > 0) {
			return;
		}

		// Nobody is waiting any more: demote the queued task, or drop it if the viewport doesn't need it.
		this.#waiters.delete(key);
		const queued = this.#queue.get(key);
		if (!queued) {
			return;
		}
		queued.precache = false;
		if (!queued.active) {
			this.#queue.delete(key);
		}
	}

	#dequeueNext(count: number): QueuedTask[] {
		if (count <= 0 || this.#queue.size === 0) {
			return [];
		}

		// While paused only precache work may start; viewport-only tiles wait for `resume()`.
		const selected = Array.from(this.#queue.values())
			.filter((task) => !this.#paused || task.precache)
			.sort((a, b) => {
				if (a.active !== b.active) {
					return a.active ? -1 : 1;
				}
				return a.distanceSq - b.distanceSq;
			})
			.slice(0, count);

		selected.forEach((task) => this.#queue.delete(task.spec.key));
		return selected;
	}

	#pump(): void {
		if (this.#disposed) {
			return;
		}
		this.#dequeueNext(this.#maxConcurrent - this.#inFlightCount).forEach((task) =>
			this.#runTask(task)
		);
	}

	// --- Loading ---

	#loadWithRetries(
		spec: TileSpec,
		priority: TilePriority,
		remainingRetries: number
	): Promise<HTMLImageElement | undefined> {
		return this.#loadImage(spec.url, { priority, crossOrigin: this.#crossOrigin }).catch(
			(error: unknown) => {
				if (this.#disposed || remainingRetries <= 0) {
					throw error;
				}
				return this.#loadWithRetries(spec, priority, remainingRetries - 1);
			}
		);
	}

	#runTask(task: QueuedTask): void {
		const { spec } = task;
		const generation = this.#generation;

		this.#inFlightCount += 1;
		this.#inFlight.set(spec.key, generation);
		this.#cache.upsertFromSpec(spec, 'loading');

		// `then(onLoaded, onFailed)` rather than `.then().catch()`, so an error thrown while handling a
		// successful load can never be mistaken for a failed load.
		void this.#loadWithRetries(spec, task.active ? 'active' : 'precache', this.#maxRetries)
			.then(
				(image) => this.#handleLoaded(spec, generation, image),
				(error: unknown) => this.#handleFailed(spec, generation, error)
			)
			.finally(() => {
				this.#inFlightCount -= 1;
				if (this.#inFlight.get(spec.key) === generation) {
					this.#inFlight.delete(spec.key);
				}
				this.#pump();
			});
	}

	#isStale(generation: number): boolean {
		return this.#disposed || generation !== this.#generation;
	}

	#handleLoaded(spec: TileSpec, generation: number, image: HTMLImageElement | undefined): void {
		if (this.#isStale(generation)) {
			return;
		}
		this.#failureCounts.delete(spec.key);
		this.#clearRetryTimer(spec.key);
		this.#cache.setReady(spec, image);
		this.#notifyWaiters(spec.key, 'loaded');
		this.#invokeCallback(() => this.#onChange?.());
	}

	#handleFailed(spec: TileSpec, generation: number, error: unknown): void {
		if (this.#isStale(generation)) {
			return;
		}
		this.#failureCounts.set(spec.key, (this.#failureCounts.get(spec.key) ?? 0) + 1);
		this.#cache.setError(spec, error);
		this.#notifyWaiters(spec.key, 'failed');
		this.#invokeCallback(() =>
			this.#onTileError?.({
				key: spec.key,
				level: spec.level,
				col: spec.col,
				row: spec.row,
				url: spec.url,
				error
			})
		);
		this.#invokeCallback(() => this.#onChange?.());
		this.#scheduleRetry(spec.key);
	}

	#notifyWaiters(key: string, outcome: TileOutcome): void {
		const waiterSet = this.#waiters.get(key);
		if (!waiterSet) {
			return;
		}
		this.#waiters.delete(key);
		waiterSet.forEach((callback) => callback(outcome));
	}

	/** User callbacks must never break the loader's own bookkeeping, so their errors are only logged. */
	#invokeCallback(callback: () => void): void {
		try {
			callback();
		} catch (error) {
			console.error('[openseahorse] TileLoader callback threw:', error);
		}
	}

	// --- Failed tile retries ---

	/**
	 * Re-queues a failed tile after an exponential backoff, but only while it is still in the active
	 * viewport set. This recovers from transient network errors without hammering a missing tile.
	 */
	#scheduleRetry(key: string): void {
		if (this.#retryTimers.has(key) || !this.#activeSpecs.has(key)) {
			return;
		}

		const failures = Math.max(1, this.#failureCounts.get(key) ?? 1);
		const backoff = Math.min(
			MAX_FAILED_TILE_RETRY_DELAY,
			this.#failedTileRetryDelay * 2 ** (failures - 1)
		);
		const failedAt = this.#cache.get(key)?.failedAt ?? Date.now();
		const delay = Math.max(0, failedAt + backoff - Date.now());

		const timer = setTimeout(() => {
			this.#retryTimers.delete(key);
			const spec = this.#activeSpecs.get(key);
			if (!spec || this.#disposed || this.#cache.get(key)?.status !== 'error') {
				return;
			}
			this.#enqueueActive(spec);
			this.#pump();
		}, delay);

		this.#retryTimers.set(key, timer);
	}

	#clearRetryTimer(key: string): void {
		const timer = this.#retryTimers.get(key);
		if (timer === undefined) {
			return;
		}
		clearTimeout(timer);
		this.#retryTimers.delete(key);
	}
}
