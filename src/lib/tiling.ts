import {
	getLevelGrid,
	getLevelRange,
	getLevelSize,
	getTilePixelRect,
	getTileStageRect,
	getTileUrl,
	tileExists
} from './dzi.js';
import type { DziDescriptor, Rect, Size, TileSpec, Viewport } from './types.js';
import { getViewportBounds, rectIntersection } from './viewport.js';

export const DEFAULT_MAX_DPR = 1.5;

export function clampDpr(dpr: number, maxDpr = DEFAULT_MAX_DPR): number {
	return Math.min(maxDpr, Math.max(0.1, dpr));
}

export function makeTileKey(sourceId: string, level: number, col: number, row: number): string {
	return `${sourceId}:${level}:${col}_${row}`;
}

/**
 * Selects the smallest pyramid level whose native pixel dimensions meet or exceed
 * the image's rendered screen size scaled by `effectiveDpr`.
 */
export function getOptimalLevel(
	dzi: Pick<DziDescriptor, 'width' | 'height' | 'minLevel' | 'maxLevel'>,
	imageBounds: Rect,
	zoom: number,
	effectiveDpr = 1
): number {
	if (zoom <= 0 || imageBounds.width <= 0 || imageBounds.height <= 0) {
		return dzi.minLevel;
	}

	const density = Math.max(0.1, effectiveDpr);
	const targetWidth = imageBounds.width * zoom * density;
	const targetHeight = imageBounds.height * zoom * density;

	const match = getLevelRange(dzi).find((level) => {
		const size = getLevelSize(dzi, level);
		return size.width >= targetWidth && size.height >= targetHeight;
	});

	return match ?? dzi.maxLevel;
}

export interface ViewportTilesParams {
	readonly dzi: DziDescriptor;
	readonly imageBounds: Rect;
	readonly viewport: Viewport;
	readonly containerSize: Size;
	readonly dpr?: number;
	readonly maxDpr?: number;
	readonly quality?: number;
	readonly sourceId?: string;
	readonly levelOverride?: number;
}

export interface ViewportTilesResult {
	readonly level: number;
	readonly visibleBounds: Rect;
	readonly tiles: readonly TileSpec[];
}

/**
 * Computes only the optimal DZI tiles intersecting the current viewport,
 * ordered from the viewport centre outward.
 */
export function getTilesForViewport({
	dzi,
	imageBounds,
	viewport,
	containerSize,
	dpr = 1,
	maxDpr = DEFAULT_MAX_DPR,
	quality = 1,
	sourceId = 'default',
	levelOverride
}: ViewportTilesParams): ViewportTilesResult {
	const visibleBounds = getViewportBounds(viewport, containerSize);
	const effectiveDpr = clampDpr(dpr, maxDpr) * quality;
	const level =
		levelOverride !== undefined
			? Math.min(dzi.maxLevel, Math.max(dzi.minLevel, levelOverride))
			: getOptimalLevel(dzi, imageBounds, viewport.zoom, effectiveDpr);

	if (imageBounds.width <= 0 || imageBounds.height <= 0) {
		return { level, visibleBounds, tiles: [] };
	}

	const intersection = rectIntersection(visibleBounds, imageBounds);
	if (!intersection) {
		return { level, visibleBounds, tiles: [] };
	}

	const levelSize = getLevelSize(dzi, level);
	const grid = getLevelGrid(dzi, level);

	const uMin = (intersection.x - imageBounds.x) / imageBounds.width;
	const uMax = (intersection.x + intersection.width - imageBounds.x) / imageBounds.width;
	const vMin = (intersection.y - imageBounds.y) / imageBounds.height;
	const vMax = (intersection.y + intersection.height - imageBounds.y) / imageBounds.height;

	// Subtract a tiny epsilon on the upper edge so a viewport ending exactly on a tile boundary doesn't fetch the adjacent off-screen tile.
	const EPSILON = 1e-6;
	const colMin = Math.max(0, Math.floor((uMin * levelSize.width) / dzi.tileSize));
	const colMax = Math.min(
		grid.cols - 1,
		Math.floor(Math.max(0, uMax * levelSize.width - EPSILON) / dzi.tileSize)
	);
	const rowMin = Math.max(0, Math.floor((vMin * levelSize.height) / dzi.tileSize));
	const rowMax = Math.min(
		grid.rows - 1,
		Math.floor(Math.max(0, vMax * levelSize.height - EPSILON) / dzi.tileSize)
	);

	if (colMax < colMin || rowMax < rowMin) {
		return { level, visibleBounds, tiles: [] };
	}

	const cols = Array.from({ length: colMax - colMin + 1 }, (_, i) => colMin + i);
	const rows = Array.from({ length: rowMax - rowMin + 1 }, (_, i) => rowMin + i);

	const tiles = rows
		.flatMap((row) => cols.map((col) => ({ col, row })))
		.filter(({ col, row }) => tileExists(dzi, level, col, row))
		.map(({ col, row }) => {
			const spec = buildTileSpec(dzi, imageBounds, level, col, row, sourceId);
			const dx = spec.stageRect.x + spec.stageRect.width / 2 - viewport.x;
			const dy = spec.stageRect.y + spec.stageRect.height / 2 - viewport.y;
			return { ...spec, distanceSq: dx * dx + dy * dy };
		})
		.sort((a, b) => a.distanceSq - b.distanceSq);

	return { level, visibleBounds, tiles };
}

/** Builds the `TileSpec` for one tile coordinate, with `distanceSq` of 0. */
function buildTileSpec(
	dzi: DziDescriptor,
	imageBounds: Rect,
	level: number,
	col: number,
	row: number,
	sourceId: string
): TileSpec {
	return {
		key: makeTileKey(sourceId, level, col, row),
		level,
		col,
		row,
		url: getTileUrl(dzi, level, col, row),
		pixelRect: getTilePixelRect(dzi, level, col, row),
		stageRect: getTileStageRect(dzi, level, col, row, imageBounds),
		distanceSq: 0
	};
}

/**
 * Builds the `TileSpec` for a single specific coordinate (used e.g. for preloading the single-tile base level).
 */
export function buildSingleTileSpec(
	dzi: DziDescriptor,
	imageBounds: Rect,
	level: number,
	col: number,
	row: number,
	sourceId = 'default'
): TileSpec | null {
	if (!tileExists(dzi, level, col, row)) {
		return null;
	}
	return buildTileSpec(dzi, imageBounds, level, col, row, sourceId);
}
