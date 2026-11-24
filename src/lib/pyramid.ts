import type { DziDescriptor, Rect, Size, TileGrid } from './types.js';

// Deep Zoom pyramid maths: level sizes, tile grids and tile rectangles.

/** Highest pyramid level: the one at full resolution, where the longest side is 2^level pixels or less. */
export function getMaxLevel(width: number, height: number): number {
	return Math.ceil(Math.log2(Math.max(1, width, height)));
}

/** Every pyramid level from `minLevel` to `maxLevel`, lowest resolution first. */
export function getLevelRange(dzi: Pick<DziDescriptor, 'minLevel' | 'maxLevel'>): number[] {
	return Array.from(
		{ length: dzi.maxLevel - dzi.minLevel + 1 },
		(_, index) => dzi.minLevel + index
	);
}

export function getLevelScale(maxLevel: number, level: number): number {
	return 1 / 2 ** (maxLevel - level);
}

/**
 * Level sizes per descriptor object. `getLevelSize` runs several times per visible tile on every animation
 * frame, so each level's size is worked out once. Descriptors are treated as immutable.
 */
const levelSizeCache = new WeakMap<object, Map<number, Size>>();

/**
 * Returns the pixel dimensions of pyramid `level` using Deep Zoom integer halving (`ceil(dim / 2^(maxLevel - level))`).
 */
export function getLevelSize(
	dzi: Pick<DziDescriptor, 'width' | 'height' | 'maxLevel'>,
	level: number
): Size {
	const sizes = levelSizeCache.get(dzi) ?? new Map<number, Size>();
	levelSizeCache.set(dzi, sizes);

	const cached = sizes.get(level);
	if (cached) {
		return cached;
	}

	const divisor = 2 ** (dzi.maxLevel - level);
	const size: Size = {
		width: Math.max(1, Math.ceil(dzi.width / divisor)),
		height: Math.max(1, Math.ceil(dzi.height / divisor))
	};
	sizes.set(level, size);
	return size;
}

export function getLevelGrid(
	dzi: Pick<DziDescriptor, 'width' | 'height' | 'tileSize' | 'maxLevel'>,
	level: number
): TileGrid {
	const levelSize = getLevelSize(dzi, level);
	return {
		cols: Math.ceil(levelSize.width / dzi.tileSize),
		rows: Math.ceil(levelSize.height / dzi.tileSize)
	};
}

/**
 * Returns a tile's position and dimensions in level-native pixels, including DZI overlap on interior edges.
 */
export function getTilePixelRect(
	dzi: Pick<DziDescriptor, 'width' | 'height' | 'tileSize' | 'overlap' | 'maxLevel'>,
	level: number,
	col: number,
	row: number
): Rect {
	const levelSize = getLevelSize(dzi, level);
	const x = col === 0 ? 0 : col * dzi.tileSize - dzi.overlap;
	const y = row === 0 ? 0 : row * dzi.tileSize - dzi.overlap;
	const rawWidth = dzi.tileSize + (col === 0 ? 1 : 2) * dzi.overlap;
	const rawHeight = dzi.tileSize + (row === 0 ? 1 : 2) * dzi.overlap;

	return {
		x,
		y,
		width: Math.max(0, Math.min(rawWidth, levelSize.width - x)),
		height: Math.max(0, Math.min(rawHeight, levelSize.height - y))
	};
}

/**
 * Returns a tile's non-overlapping logical footprint projected into virtual stage coordinates.
 * Used for viewport culling and exact coverage subtraction without overlap double-counting.
 */
export function getTileStageRect(
	dzi: Pick<DziDescriptor, 'width' | 'height' | 'tileSize' | 'maxLevel'>,
	level: number,
	col: number,
	row: number,
	imageBounds: Rect
): Rect {
	const levelSize = getLevelSize(dzi, level);
	const logicalX = col * dzi.tileSize;
	const logicalY = row * dzi.tileSize;
	const logicalWidth = Math.max(0, Math.min(dzi.tileSize, levelSize.width - logicalX));
	const logicalHeight = Math.max(0, Math.min(dzi.tileSize, levelSize.height - logicalY));

	return {
		x: imageBounds.x + (logicalX / levelSize.width) * imageBounds.width,
		y: imageBounds.y + (logicalY / levelSize.height) * imageBounds.height,
		width: (logicalWidth / levelSize.width) * imageBounds.width,
		height: (logicalHeight / levelSize.height) * imageBounds.height
	};
}

export function getTileUrl(dzi: DziDescriptor, level: number, col: number, row: number): string {
	if (dzi.getTileUrl) {
		return dzi.getTileUrl(level, col, row);
	}
	return `${dzi.tilesUrl}${level}/${col}_${row}.${dzi.format}${dzi.queryParams ?? ''}`;
}

export function tileExists(dzi: DziDescriptor, level: number, col: number, row: number): boolean {
	if (level < dzi.minLevel || level > dzi.maxLevel) {
		return false;
	}

	const grid = getLevelGrid(dzi, level);
	if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) {
		return false;
	}

	if (!dzi.displayRects || dzi.displayRects.length === 0) {
		return true;
	}

	const rectsForLevel = dzi.displayRects.filter(
		(rect) => level >= rect.minLevel && level <= rect.maxLevel
	);
	if (rectsForLevel.length === 0) {
		return true;
	}

	const scale = getLevelScale(dzi.maxLevel, level);
	return rectsForLevel.some((rect) => {
		const colMin = Math.floor((rect.x * scale) / dzi.tileSize);
		const rowMin = Math.floor((rect.y * scale) / dzi.tileSize);
		const colMax = Math.ceil(((rect.x + rect.width) * scale) / dzi.tileSize);
		const rowMax = Math.ceil(((rect.y + rect.height) * scale) / dzi.tileSize);
		return col >= colMin && col < colMax && row >= rowMin && row < rowMax;
	});
}

/**
 * Returns the highest pyramid level that still fits inside a single 1x1 tile.
 */
export function getClosestSingleTileLevel(dzi: DziDescriptor): number {
	const singleTileLevels = getLevelRange(dzi).filter((level) => {
		const grid = getLevelGrid(dzi, level);
		return grid.cols === 1 && grid.rows === 1;
	});

	return singleTileLevels.at(-1) ?? dzi.minLevel;
}
