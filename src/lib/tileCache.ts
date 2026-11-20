import type { CachedTile, TileSpec } from './types.js';

export interface TileCacheOptions {
	readonly maxCachedTiles?: number;
}

/**
 * LRU cache of decoded tile entries keyed by tile key.
 * Protected keys (currently visible tiles, active fallbacks, or in-flight loads) are never evicted.
 */
export class TileCache {
	readonly #entries = new Map<string, CachedTile>();
	#maxCachedTiles: number;
	#tick = 0;

	constructor(options?: TileCacheOptions) {
		this.#maxCachedTiles = Math.max(16, options?.maxCachedTiles ?? 256);
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
		this.#entries.delete(key);
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
		return created;
	}

	setReady(spec: TileSpec, image?: HTMLImageElement): CachedTile {
		const entry = this.upsertFromSpec(spec, 'ready');
		entry.image = image;
		entry.error = undefined;
		entry.failedAt = undefined;
		return entry;
	}

	setError(spec: TileSpec, error: unknown): CachedTile {
		const entry = this.upsertFromSpec(spec, 'error');
		entry.error = error;
		entry.failedAt = Date.now();
		return entry;
	}

	getReadyTiles(): CachedTile[] {
		return Array.from(this.#entries.values()).filter((entry) => entry.status === 'ready');
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

		candidates.forEach((entry) => {
			this.#entries.delete(entry.key);
		});

		return candidates.length;
	}

	remapStageRects(computeRect: (tile: CachedTile) => CachedTile['stageRect']): void {
		this.#entries.forEach((entry) => {
			entry.stageRect = computeRect(entry);
		});
	}

	clear(): void {
		this.#entries.clear();
		this.#tick = 0;
	}
}
