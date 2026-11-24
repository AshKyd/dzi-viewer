/** Frees an `ImageBitmap`'s pixel memory right away instead of waiting for garbage collection. */
export function closeBitmap(bitmap: ImageBitmap | undefined): void {
	if (bitmap && typeof bitmap.close === 'function') {
		bitmap.close();
	}
}

/**
 * Deep-copies arrays and objects into plain values and drops functions, so the result survives `postMessage`.
 * Needed because Svelte `$state` proxies (e.g. a bound `imageBounds`) can't be structured-cloned.
 */
export function toCloneable<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((item: unknown) => toCloneable(item)) as T;
	}
	if (value === null || typeof value !== 'object') {
		return value;
	}
	return Object.fromEntries(
		Object.entries(value)
			.filter(([, entry]) => typeof entry !== 'function')
			.map(([key, entry]) => [key, toCloneable(entry)])
	) as T;
}

/** High-resolution timestamp in ms, falling back to `Date.now()` where `performance` is missing. */
export function nowMs(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
