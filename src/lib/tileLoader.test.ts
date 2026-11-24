import { afterEach, describe, expect, it, vi } from 'vitest';
import { TileCache } from './tileCache.js';
import { TileLoader } from './tileLoader.js';
import type { TileSpec } from './types.js';

function makeSpec(col: number, distanceSq = col): TileSpec {
	return {
		key: `src:10:${col}_0`,
		level: 10,
		col,
		row: 0,
		url: `https://example.com/10/${col}_0.jpg`,
		pixelRect: { x: col * 256, y: 0, width: 256, height: 256 },
		stageRect: { x: col * 256, y: 0, width: 256, height: 256 },
		distanceSq
	};
}

/**
 * Waits until every pending microtask has run. Counting `await Promise.resolve()` ticks is brittle because
 * the number of hops between a settled image and the loader's next `#pump()` depends on its promise chain.
 */
function flushPromises(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A loader whose image loads stay pending until the test resolves them in order. */
function createManualLoader(options: { maxConcurrent?: number; onChange?: () => void } = {}) {
	const cache = new TileCache();
	const startedUrls: string[] = [];
	const resolvers: Array<() => void> = [];
	const loader = new TileLoader({
		cache,
		// Pass `maxConcurrent: undefined` explicitly to use the loader's default.
		maxConcurrent: 'maxConcurrent' in options ? options.maxConcurrent : 1,
		onChange: options.onChange,
		loadImage: (url) => {
			startedUrls.push(url);
			return new Promise<undefined>((resolve) => {
				resolvers.push(() => resolve(undefined));
			});
		}
	});
	const resolveNext = async () => {
		resolvers.shift()?.();
		await flushPromises();
	};
	return { cache, loader, startedUrls, resolveNext };
}

describe('TileCache and TileLoader', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('prioritises active viewport tiles ahead of precache tiles and respects concurrency limit', async () => {
		const { loader, startedUrls, resolveNext } = createManualLoader();

		const precachePromise = loader.precacheTiles([makeSpec(0, 0), makeSpec(1, 1)]);
		// Tile 0 starts immediately (maxConcurrent = 1), tile 1 waits in queue.
		expect(startedUrls).toEqual(['https://example.com/10/0_0.jpg']);

		// Now an active viewport tile arrives; it must jump ahead of queued precache tile 1.
		loader.setActiveTiles([makeSpec(2, 50)]);

		await resolveNext();
		expect(startedUrls).toEqual([
			'https://example.com/10/0_0.jpg',
			'https://example.com/10/2_0.jpg'
		]);

		await resolveNext();
		expect(startedUrls).toEqual([
			'https://example.com/10/0_0.jpg',
			'https://example.com/10/2_0.jpg',
			'https://example.com/10/1_0.jpg'
		]);

		await resolveNext();
		const result = await precachePromise;
		expect(result).toEqual({ total: 2, loaded: 2, failed: 0, cancelled: false });
	});

	it('drops queued active tiles that leave the viewport before starting', async () => {
		const { loader, startedUrls, resolveNext } = createManualLoader();

		loader.setActiveTiles([makeSpec(0, 0), makeSpec(1, 1)]);
		// Pan away before tile 1 starts loading
		loader.setActiveTiles([makeSpec(2, 0)]);

		await resolveNext();

		expect(startedUrls).toEqual([
			'https://example.com/10/0_0.jpg',
			'https://example.com/10/2_0.jpg'
		]);
		await resolveNext();
	});

	it('supports aborting precacheTiles via AbortSignal', async () => {
		const cache = new TileCache();
		const controller = new AbortController();

		const loader = new TileLoader({
			cache,
			maxConcurrent: 1,
			loadImage: () => new Promise<undefined>(() => undefined)
		});

		const promise = loader.precacheTiles([makeSpec(0), makeSpec(1)], controller.signal);
		controller.abort();

		const result = await promise;
		expect(result.cancelled).toBe(true);
	});

	it('counts duplicate precache keys once', async () => {
		const { loader, resolveNext } = createManualLoader({ maxConcurrent: 2 });

		const promise = loader.precacheTiles([makeSpec(0), makeSpec(0), makeSpec(1)]);
		await resolveNext();
		await resolveNext();

		expect(await promise).toEqual({ total: 2, loaded: 2, failed: 0, cancelled: false });
	});

	it('discards loads that finish after reset() and cancels pending precaches', async () => {
		const onChange = vi.fn();
		const { cache, loader, resolveNext } = createManualLoader({ onChange });

		loader.setActiveTiles([makeSpec(0)]);
		const precachePromise = loader.precacheTiles([makeSpec(1)]);
		expect(cache.get('src:10:0_0')?.status).toBe('loading');

		loader.reset();
		expect(cache.has('src:10:0_0')).toBe(false);
		expect(await precachePromise).toMatchObject({ cancelled: true });

		// The image that was already downloading finishes after the reset.
		await resolveNext();
		expect(cache.has('src:10:0_0')).toBe(false);
		expect(onChange).not.toHaveBeenCalled();
	});

	it('keeps a loaded tile ready and keeps loading when onChange throws', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { cache, loader, startedUrls, resolveNext } = createManualLoader({
			onChange: () => {
				throw new Error('consumer bug');
			}
		});

		loader.setActiveTiles([makeSpec(0, 0), makeSpec(1, 1)]);
		await resolveNext();

		expect(cache.get('src:10:0_0')?.status).toBe('ready');
		expect(startedUrls).toEqual([
			'https://example.com/10/0_0.jpg',
			'https://example.com/10/1_0.jpg'
		]);
		expect(console.error).toHaveBeenCalled();
	});

	it('retries failed tiles before emitting onTileError, then again after a backoff while visible', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
		const cache = new TileCache();
		let attempts = 0;
		const errors: string[] = [];

		const loader = new TileLoader({
			cache,
			maxRetries: 2,
			failedTileRetryDelay: 1000,
			loadImage: () => {
				attempts += 1;
				return Promise.reject(new Error('network error'));
			},
			onTileError: (event) => {
				errors.push(event.key);
			}
		});

		const result = await loader.precacheTiles([makeSpec(0)]);
		expect(attempts).toBe(3);
		expect(errors).toEqual(['src:10:0_0']);
		expect(result).toEqual({ total: 1, loaded: 0, failed: 1, cancelled: false });

		// Becoming visible does not re-request straight away...
		loader.setActiveTiles([makeSpec(0)]);
		await vi.advanceTimersByTimeAsync(0);
		expect(attempts).toBe(3);

		// ...but does once the backoff has passed (another 3 attempts including retries).
		await vi.advanceTimersByTimeAsync(1000);
		expect(attempts).toBe(6);

		// Leaving the viewport cancels further retries.
		loader.setActiveTiles([]);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(attempts).toBe(6);
	});

	it('holds viewport loads while paused, keeps precaching, and loads only the final viewport on resume', async () => {
		const { loader, startedUrls, resolveNext } = createManualLoader({ maxConcurrent: 4 });

		loader.pause();
		expect(loader.isPaused).toBe(true);

		// Intermediate viewports during an animation: nothing starts.
		loader.setActiveTiles([makeSpec(0), makeSpec(1)]);
		loader.setActiveTiles([makeSpec(2)]);
		await flushPromises();
		expect(startedUrls).toEqual([]);

		// Precaching the destination still runs while paused.
		const precachePromise = loader.precacheTiles([makeSpec(5)]);
		expect(startedUrls).toEqual(['https://example.com/10/5_0.jpg']);
		await resolveNext();
		expect(await precachePromise).toMatchObject({ loaded: 1 });

		// The animation lands: only the final viewport's tiles load.
		loader.setActiveTiles([makeSpec(3), makeSpec(4)]);
		loader.resume();
		expect(loader.isPaused).toBe(false);
		expect(startedUrls).toEqual([
			'https://example.com/10/5_0.jpg',
			'https://example.com/10/3_0.jpg',
			'https://example.com/10/4_0.jpg'
		]);
	});

	it('defaults to 16 parallel loads', () => {
		const { loader, startedUrls } = createManualLoader({ maxConcurrent: undefined });
		loader.setActiveTiles(Array.from({ length: 20 }, (_, col) => makeSpec(col)));
		expect(startedUrls).toHaveLength(16);
	});

	it('keeps the ready-by-level index in step with status changes, deletes, evictions and clear', () => {
		const cache = new TileCache({ maxCachedTiles: 16 });
		const otherLevel = (col: number): TileSpec => ({
			...makeSpec(col),
			key: `src:9:${col}_0`,
			level: 9
		});
		const readyKeysByLevel = () =>
			Object.fromEntries(
				Array.from(cache.getReadyTilesByLevel()).map(([level, tiles]) => [
					level,
					Array.from(tiles, (tile) => tile.key).sort()
				])
			);

		cache.setReady(makeSpec(0));
		cache.setReady(makeSpec(1));
		cache.setReady(otherLevel(0));
		cache.upsertFromSpec(makeSpec(2), 'loading');
		expect(readyKeysByLevel()).toEqual({ 9: ['src:9:0_0'], 10: ['src:10:0_0', 'src:10:1_0'] });

		// A ready tile that fails on a retry leaves the index; the last tile of a level removes the level.
		cache.setError(makeSpec(1), new Error('gone'));
		cache.delete('src:9:0_0');
		expect(readyKeysByLevel()).toEqual({ 10: ['src:10:0_0'] });

		// Eviction removes from the index too.
		Array.from({ length: 20 }, (_, i) => makeSpec(i + 3)).forEach((spec) => cache.setReady(spec));
		cache.evict(new Set());
		expect(
			[...cache.getReadyTilesByLevel().values()].every((tiles) =>
				[...tiles].every((tile) => cache.has(tile.key))
			)
		).toBe(true);
		expect(cache.has('src:10:0_0')).toBe(false);

		cache.clear();
		expect(cache.getReadyTilesByLevel().size).toBe(0);
	});

	it('evicts least-recently-used entries while protecting mounted keys', () => {
		const cache = new TileCache({ maxCachedTiles: 16 });
		const specs = Array.from({ length: 20 }, (_, i) => makeSpec(i));
		specs.forEach((spec) => cache.setReady(spec));

		// Protect the oldest tile (col 0) even though it has the lowest lastUsed
		const protectedKeys = new Set<string>(['src:10:0_0']);
		const evicted = cache.evict(protectedKeys);

		expect(evicted).toBe(4);
		expect(cache.size).toBe(16);
		expect(cache.has('src:10:0_0')).toBe(true);
		expect(cache.has('src:10:1_0')).toBe(false);
	});

	it('closes ImageBitmaps on delete, overwrite, eviction, clear, and stale loader completion', async () => {
		const makeBitmap = () => {
			const close = vi.fn<() => void>();
			const bitmap: ImageBitmap = { width: 256, height: 256, close };
			return { bitmap, close };
		};

		const cache = new TileCache({ maxCachedTiles: 16 });
		const first = makeBitmap();
		const replacement = makeBitmap();
		cache.setReady(makeSpec(0), first.bitmap);
		cache.setReady(makeSpec(0), replacement.bitmap);
		expect(first.close).toHaveBeenCalledTimes(1);
		expect(replacement.close).not.toHaveBeenCalled();

		cache.delete('src:10:0_0');
		expect(replacement.close).toHaveBeenCalledTimes(1);

		const bitmaps = Array.from({ length: 18 }, () => makeBitmap());
		bitmaps.forEach((entry, i) => cache.setReady(makeSpec(i), entry.bitmap));
		cache.evict(new Set());
		expect(bitmaps[0]?.close).toHaveBeenCalledTimes(1);
		expect(bitmaps[1]?.close).toHaveBeenCalledTimes(1);
		expect(bitmaps[2]?.close).not.toHaveBeenCalled();

		cache.clear();
		expect(bitmaps[2]?.close).toHaveBeenCalledTimes(1);

		// Loader aborts in-flight signal on reset() and closes any stale ImageBitmap that still resolves.
		let resolveLate!: (bitmap: ImageBitmap) => void;
		let capturedSignal: AbortSignal | undefined;
		const loader = new TileLoader({
			cache,
			maxConcurrent: 1,
			loadImage: (_url, { signal }) => {
				capturedSignal = signal;
				return new Promise((resolve) => {
					resolveLate = resolve;
				});
			}
		});

		loader.setActiveTiles([makeSpec(0)]);
		expect(capturedSignal?.aborted).toBe(false);
		loader.reset();
		expect(capturedSignal?.aborted).toBe(true);

		const lateBitmap = makeBitmap();
		resolveLate(lateBitmap.bitmap);
		await flushPromises();
		expect(lateBitmap.close).toHaveBeenCalledTimes(1);
		expect(cache.has('src:10:0_0')).toBe(false);
	});
});
