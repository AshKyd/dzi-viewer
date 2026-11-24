import type { TileLoader } from './tileLoader.js';
import { getTilesForViewport } from './tiling.js';
import type {
	DziDescriptor,
	PrecacheOptions,
	PrecacheResult,
	Rect,
	Size,
	Viewport,
	ViewportFitOptions
} from './types.js';
import { getFillViewport, getFitViewport } from './viewport.js';

/** Result returned when there is nothing to precache yet (no DZI loaded or no container size). */
export const EMPTY_PRECACHE_RESULT: PrecacheResult = Object.freeze({
	total: 0,
	loaded: 0,
	failed: 0,
	cancelled: false
});

/** Result returned when a precache is aborted before any tile settled. */
export const CANCELLED_PRECACHE_RESULT: PrecacheResult = Object.freeze({
	total: 0,
	loaded: 0,
	failed: 0,
	cancelled: true
});

export interface PrecacheViewportParams extends PrecacheOptions {
	readonly dzi: DziDescriptor;
	readonly imageBounds: Rect;
	readonly viewport: Viewport;
	readonly containerSize: Size;
	readonly loader: TileLoader;
	readonly sourceId?: string;
}

/**
 * Resolves the optimal tiles for a target viewport and pre-caches them into the shared `TileLoader`.
 */
export function precacheViewport({
	dzi,
	imageBounds,
	viewport,
	containerSize,
	loader,
	sourceId = 'default',
	dpr = 1,
	maxDpr,
	quality = 1,
	signal
}: PrecacheViewportParams): Promise<PrecacheResult> {
	const { tiles } = getTilesForViewport({
		dzi,
		imageBounds,
		viewport,
		containerSize,
		dpr,
		maxDpr,
		quality,
		sourceId
	});

	return loader.precacheTiles(tiles, signal);
}

export interface PrecacheBoundsParams extends PrecacheOptions, ViewportFitOptions {
	readonly dzi: DziDescriptor;
	readonly imageBounds: Rect;
	readonly bounds: Rect;
	readonly mode: 'fit' | 'fill';
	readonly containerSize: Size;
	readonly loader: TileLoader;
	readonly sourceId?: string;
}

/**
 * Resolves the fit or fill viewport for `bounds` and pre-caches its optimal tiles.
 */
export function precacheBounds({
	bounds,
	mode,
	padding,
	containerSize,
	...rest
}: PrecacheBoundsParams): Promise<PrecacheResult> {
	const viewport =
		mode === 'fit'
			? getFitViewport(bounds, containerSize, { padding })
			: getFillViewport(bounds, containerSize, { padding });

	return precacheViewport({
		...rest,
		viewport,
		containerSize
	});
}
