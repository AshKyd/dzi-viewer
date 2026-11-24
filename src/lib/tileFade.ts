/**
 * Tracks each tile's fade-in and which tiles are fully opaque.
 * The engine keeps fallback tiles mounted under an optimal tile until it is opaque, so newly opaque
 * keys are collected for the next engine sync (`takeNewlyOpaque`).
 */
export class TileFadeTracker {
	readonly #fadeStart = new Map<string, number>();
	readonly #opaque = new Set<string>();
	readonly #newlyOpaque = new Set<string>();

	isOpaque(key: string): boolean {
		return this.#opaque.has(key);
	}

	/** Marks `key` fully opaque. Returns true only the first time. */
	markOpaque(key: string): boolean {
		if (this.#opaque.has(key)) {
			return false;
		}
		this.#opaque.add(key);
		this.#newlyOpaque.add(key);
		return true;
	}

	/** Alpha (0–1) for `key` at `now`; its fade starts the first time this is called. */
	alphaAt(key: string, now: number, durationMs: number): number {
		const startedAt = this.#fadeStart.get(key) ?? now;
		this.#fadeStart.set(key, startedAt);
		return Math.min(1, Math.max(0, (now - startedAt) / durationMs));
	}

	/** Starts the fade over, e.g. when a tile's bitmap is replaced. */
	restartFade(key: string): void {
		this.#fadeStart.delete(key);
	}

	forget(key: string): void {
		this.#fadeStart.delete(key);
		this.#opaque.delete(key);
		this.#newlyOpaque.delete(key);
	}

	clear(): void {
		this.#fadeStart.clear();
		this.#opaque.clear();
		this.#newlyOpaque.clear();
	}

	/** Returns opaque keys not yet reported to the engine, and forgets them. */
	takeNewlyOpaque(): string[] {
		const keys = [...this.#newlyOpaque];
		this.#newlyOpaque.clear();
		return keys;
	}
}
