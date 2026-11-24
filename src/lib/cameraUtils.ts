/** Copies `source` without its `undefined` fields, so spreading it never overwrites a default. */
export function pickDefined<T extends object>(source: T | undefined): Partial<T> {
	return Object.fromEntries(
		Object.entries(source ?? {}).filter(([, value]) => value !== undefined)
	) as Partial<T>;
}

/** Calls `handler` once if `signal` aborts; returns a function that stops listening. */
export function onAbort(signal: AbortSignal | undefined, handler: () => void): () => void {
	signal?.addEventListener('abort', handler, { once: true });
	return () => signal?.removeEventListener('abort', handler);
}

/**
 * Returns a check that skips animation frames to stay at or under `maxFps` (no cap when unset).
 * Allows a little jitter, so 60 Hz / 120 Hz `requestAnimationFrame` timing doesn't turn a 30 fps cap into 20 fps.
 */
export function createFrameLimiter(maxFps?: number): (frameTime: number) => boolean {
	const frameIntervalMs =
		maxFps !== undefined && Number.isFinite(maxFps) && maxFps > 0 ? 1000 / maxFps : 0;
	if (frameIntervalMs === 0) {
		return () => true;
	}
	const minIntervalMs = frameIntervalMs - Math.min(2, frameIntervalMs * 0.1);
	let lastRenderTime = Number.NEGATIVE_INFINITY;
	return (frameTime) => {
		if (frameTime - lastRenderTime < minIntervalMs) {
			return false;
		}
		lastRenderTime = frameTime;
		return true;
	};
}

/** `matchMedia('(prefers-reduced-motion: reduce)')`, false outside a browser. */
export function prefersReducedMotion(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}
