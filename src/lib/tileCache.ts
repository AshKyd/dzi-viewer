import type { CachedTile, TileSpec } from './types.js';
import { closeBitmap } from './utils.js';

export interface TileCacheOptions {
	readonly maxCachedTiles?: number;
	/** Called whenever a cached entry is evicted, deleted, overwritten, or cleared. */
	readonly onDelete?: (key: string) => void;
	/** Called when a tile transitions to `ready` with its decoded `ImageBitmap`. */
	readonly onReady?: (entry: CachedTile) => void;
}

/** Frees an entry's bitmap and detaches it so nothing draws a closed bitmap. */
function releaseEntryBitmap(entry: CachedTile): void {
	closeBitmap(entry.bitmap);
	entry.bitmap = undefined;
}

/**
 * LRU cache of decoded tile entries keyed by tile key.
 * Protected keys (currently visible tiles, active fallbacks, or in-flight loads) are never evicted.
 * Evicted, deleted, and cleared entries explicitly close their `ImageBitmap` to release GPU/RAM immediately.
 */
export class TileCache {
	readonly #entries = new Map<string, CachedTile>();
	/**
	 * Ready tiles grouped by pyramid level. The render plan needs this every frame to find fallback tiles,
	 * so it's kept up to date on every status change instead of scanning and grouping the whole cache.
	 */
	readonly #readyByLevel = new Map<number, Set<CachedTile>>();
	readonly #onDelete?: (key: string) => void;
	readonly #onReady?: (entry: CachedTile) => void;
	#maxCachedTiles: number;
	#tick = 0;

	constructor(options?: TileCacheOptions) {
		this.#maxCachedTiles = Math.max(16, options?.maxCachedTiles ?? 256);
		this.#onDelete = options?.onDelete;
		this.#onReady = options?.onReady;
	}

	get size(): number {
		return this.#entries.size;
	}

	get maxCachedTiles(): number {
		return this.#maxCachedTiles;
	}

	setMaxCachedTiles(limit: number): void {
		this.#maxCachedTiles = Math.max(16, limit);
	}

	get(key: string): CachedTile | undefined {
		return this.#entries.get(key);
	}

	has(key: string): boolean {
		return this.#entries.has(key);
	}

	delete(key: string): void {
		const entry = this.#entries.get(key);
		if (entry) {
			releaseEntryBitmap(entry);
			this.#removeFromReadyIndex(entry);
			this.#entries.delete(key);
			this.#onDelete?.(key);
		}
	}

	touch(key: string): void {
		const entry = this.#entries.get(key);
		if (entry) {
			this.#tick += 1;
			entry.lastUsed = this.#tick;
		}
	}

	upsertFromSpec(spec: TileSpec, status: CachedTile['status']): CachedTile {
		this.#tick += 1;
		const existing = this.#entries.get(spec.key);
		if (existing) {
			existing.status = status;
			existing.stageRect = spec.stageRect;
			existing.lastUsed = this.#tick;
			this.#updateReadyIndex(existing);
			return existing;
		}

		const created: CachedTile = {
			key: spec.key,
			level: spec.level,
			col: spec.col,
			row: spec.row,
			url: spec.url,
			pixelRect: spec.pixelRect,
			stageRect: spec.stageRect,
			status,
			lastUsed: this.#tick
		};
		this.#entries.set(spec.key, created);
		this.#updateReadyIndex(created);
		return created;
	}

	setReady(spec: TileSpec, bitmap?: ImageBitmap): CachedTile {
		const entry = this.upsertFromSpec(spec, 'ready');
		if (entry.bitmap && entry.bitmap !== bitmap) {
			closeBitmap(entry.bitmap);
			this.#onDelete?.(spec.key);
		}
		entry.bitmap = bitmap;
		entry.error = undefined;
		entry.failedAt = undefined;
		this.#onReady?.(entry);
		return entry;
	}

	setError(spec: TileSpec, error: unknown): CachedTile {
		const entry = this.upsertFromSpec(spec, 'error');
		entry.error = error;
		entry.failedAt = Date.now();
		return entry;
	}

	/** Ready tiles grouped by pyramid level. Levels with no ready tiles are left out. */
	getReadyTilesByLevel(): ReadonlyMap<number, ReadonlySet<CachedTile>> {
		return this.#readyByLevel;
	}

	evict(protectedKeys: ReadonlySet<string>): number {
		const excess = this.#entries.size - this.#maxCachedTiles;
		if (excess <= 0) {
			return 0;
		}

		const candidates = Array.from(this.#entries.values())
			.filter((entry) => entry.status !== 'loading' && !protectedKeys.has(entry.key))
			.sort((a, b) => a.lastUsed - b.lastUsed)
			.slice(0, excess);

		candidates.forEach((entry) => this.delete(entry.key));

		return candidates.length;
	}

	remapStageRects(computeRect: (tile: CachedTile) => CachedTile['stageRect']): void {
		this.#entries.forEach((entry) => {
			entry.stageRect = computeRect(entry);
		});
	}

	clear(): void {
		const keys = Array.from(this.#entries.keys());
		this.#entries.forEach((entry) => releaseEntryBitmap(entry));
		this.#entries.clear();
		this.#readyByLevel.clear();
		this.#tick = 0;
		keys.forEach((key) => this.#onDelete?.(key));
	}

	// --- Ready index ---

	#updateReadyIndex(entry: CachedTile): void {
		if (entry.status !== 'ready') {
			this.#removeFromReadyIndex(entry);
			return;
		}
		const levelTiles = this.#readyByLevel.get(entry.level) ?? new Set<CachedTile>();
		levelTiles.add(entry);
		this.#readyByLevel.set(entry.level, levelTiles);
	}

	#removeFromReadyIndex(entry: CachedTile): void {
		const levelTiles = this.#readyByLevel.get(entry.level);
		if (!levelTiles) {
			return;
		}
		levelTiles.delete(entry);
		if (levelTiles.size === 0) {
			this.#readyByLevel.delete(entry.level);
		}
	}
}
