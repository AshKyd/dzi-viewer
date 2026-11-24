/** Frees an `ImageBitmap`'s pixel memory right away instead of waiting for garbage collection. */
export function closeBitmap(bitmap: ImageBitmap | undefined): void {
	if (bitmap && typeof bitmap.close === 'function') {
		bitmap.close();
	}
}

/** High-resolution timestamp in ms, falling back to `Date.now()` where `performance` is missing. */
export function nowMs(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
