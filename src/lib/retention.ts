import { getLevelSize } from './dzi.js';
import type { TileCache } from './tileCache.js';
import type {
	CachedTile,
	DziDescriptor,
	Point,
	Rect,
	RenderLevelLayer,
	TileSpec
} from './types.js';
import { rectIntersection, rectIntersects } from './viewport.js';

const COVERAGE_EPSILON = 1e-6;

/** Chunk interval (in level pixels) used to rebase DOM layer origins and keep GPU layer bounds compact. */
export const LAYER_ORIGIN_CHUNK_SIZE = 2048;

/**
 * Computes a chunk-aligned local origin in level pixels so mounted `.dzi-tile` coordinates
 * remain close to `(0, 0)` even when viewing deep corners of very large DZI pyramids.
 */
export function computeLayerOrigin(
	tiles: readonly CachedTile[],
	chunkSize = LAYER_ORIGIN_CHUNK_SIZE
): Point {
	if (tiles.length === 0 || chunkSize <= 0) {
		return { x: 0, y: 0 };
	}

	const minX = tiles.reduce(
		(min, tile) => Math.min(min, tile.pixelRect.x),
		Number.POSITIVE_INFINITY
	);
	const minY = tiles.reduce(
		(min, tile) => Math.min(min, tile.pixelRect.y),
		Number.POSITIVE_INFINITY
	);

	return {
		x: Math.floor(minX / chunkSize) * chunkSize,
		y: Math.floor(minY / chunkSize) * chunkSize
	};
}

/**
 * Subtracts `cut` from `base`, returning up to 4 non-overlapping remainder rectangles.
 */
export function subtractRect(base: Rect, cut: Rect, epsilon = COVERAGE_EPSILON): Rect[] {
	const inter = rectIntersection(base, cut);
	if (!inter || inter.width <= epsilon || inter.height <= epsilon) {
		return [base];
	}

	const baseRight = base.x + base.width;
	const baseBottom = base.y + base.height;
	const interRight = inter.x + inter.width;
	const interBottom = inter.y + inter.height;

	const pieces: Rect[] = [
		// Top strip
		{ x: base.x, y: base.y, width: base.width, height: inter.y - base.y },
		// Bottom strip
		{ x: base.x, y: interBottom, width: base.width, height: baseBottom - interBottom },
		// Left strip
		{ x: base.x, y: inter.y, width: inter.x - base.x, height: inter.height },
		// Right strip
		{ x: interRight, y: inter.y, width: baseRight - interRight, height: inter.height }
	];

	return pieces.filter((piece) => piece.width > epsilon && piece.height > epsilon);
}

/**
 * Removes all areas covered by `cuts` from the `uncovered` rectangle list.
 */
export function subtractRects(
	uncovered: readonly Rect[],
	cuts: readonly Rect[],
	epsilon = COVERAGE_EPSILON
): Rect[] {
	return cuts.reduce<Rect[]>(
		(remaining, cut) => remaining.flatMap((rect) => subtractRect(rect, cut, epsilon)),
		[...uncovered]
	);
}

/**
 * Joins rectangles that share an edge exactly into larger ones: first along rows, then down columns.
 *
 * Tiles in one level form a grid, so the areas left uncovered and the tiles covering them arrive as many
 * small touching squares. `subtractRects` is O(uncovered × cuts) and every cut that partly overlaps splits
 * a rectangle into up to four, so merging first keeps both lists short. The union covered stays the same.
 */
export function mergeAdjacentRects(rects: readonly Rect[], epsilon = COVERAGE_EPSILON): Rect[] {
	const near = (a: number, b: number) => Math.abs(a - b) <= epsilon;

	// Same row (y and height), touching left to right.
	const rowSpans = [...rects]
		.sort((a, b) => a.y - b.y || a.height - b.height || a.x - b.x)
		.reduce<Rect[]>((spans, rect) => {
			const last = spans.at(-1);
			if (
				last &&
				near(last.y, rect.y) &&
				near(last.height, rect.height) &&
				near(last.x + last.width, rect.x)
			) {
				spans[spans.length - 1] = { ...last, width: rect.x + rect.width - last.x };
				return spans;
			}
			spans.push(rect);
			return spans;
		}, []);

	// Same column (x and width), touching top to bottom.
	return rowSpans
		.sort((a, b) => a.x - b.x || a.width - b.width || a.y - b.y)
		.reduce<Rect[]>((blocks, rect) => {
			const last = blocks.at(-1);
			if (
				last &&
				near(last.x, rect.x) &&
				near(last.width, rect.width) &&
				near(last.y + last.height, rect.y)
			) {
				blocks[blocks.length - 1] = { ...last, height: rect.y + rect.height - last.y };
				return blocks;
			}
			blocks.push(rect);
			return blocks;
		}, []);
}

/**
 * Orders tiles by row then column.
 *
 * Tiles are absolutely positioned, so their DOM order never affects what's drawn. A fixed order matters
 * for speed: `optimalTiles` is sorted by distance from the viewport centre, which changes every frame while
 * panning, and a keyed `{#each}` would otherwise physically move tile elements in the DOM on every frame.
 */
export function byGridPosition(a: CachedTile, b: CachedTile): number {
	return a.row - b.row || a.col - b.col;
}

export interface RenderPlanParams {
	readonly dzi: DziDescriptor;
	readonly optimalLevel: number;
	readonly optimalTiles: readonly TileSpec[];
	readonly visibleBounds: Rect;
	readonly cache: TileCache;
	/**
	 * Keys of tiles whose fade-in transition has completed.
	 * When provided, a tile only counts as covering underlying fallback tiles once its key is in this set,
	 * ensuring smooth crossfades before removing tiles underneath.
	 */
	readonly opaqueTileKeys?: ReadonlySet<string>;
}

export interface RenderPlan {
	readonly layers: readonly RenderLevelLayer[];
	readonly isOptimalLoaded: boolean;
	readonly mountedTileKeys: ReadonlySet<string>;
}

/**
 * Builds the ordered list of DOM level layers to render.
 * Reuses already-decoded tiles from coarser (under-zoom) and finer (over-zoom) levels
 * underneath the optimal level until 100% of visible optimal tiles are decoded and opaque.
 */
export function computeRenderPlan({
	dzi,
	optimalLevel,
	optimalTiles,
	visibleBounds,
	cache,
	opaqueTileKeys
}: RenderPlanParams): RenderPlan {
	if (optimalTiles.length === 0) {
		return { layers: [], isOptimalLoaded: true, mountedTileKeys: new Set() };
	}

	const isOpaque = (key: string): boolean => !opaqueTileKeys || opaqueTileKeys.has(key);

	const readyOptimalTiles: CachedTile[] = [];
	const uncoveredVisibleRects: Rect[] = [];
	let allOptimalReady = true;

	optimalTiles.forEach((spec) => {
		const cached = cache.get(spec.key);
		const visiblePart = rectIntersection(spec.stageRect, visibleBounds);
		const hasVisibleArea =
			visiblePart !== null &&
			visiblePart.width > COVERAGE_EPSILON &&
			visiblePart.height > COVERAGE_EPSILON;

		if (cached?.status === 'ready') {
			cache.touch(spec.key);
			readyOptimalTiles.push(cached);
			// Keep underlying tiles mounted while this optimal tile is still fading in.
			if (!isOpaque(spec.key) && hasVisibleArea && visiblePart) {
				uncoveredVisibleRects.push(visiblePart);
			}
			return;
		}

		allOptimalReady = false;
		if (hasVisibleArea && visiblePart) {
			uncoveredVisibleRects.push(visiblePart);
		}
	});
	readyOptimalTiles.sort(byGridPosition);

	if (uncoveredVisibleRects.length === 0) {
		const optimalLayer: RenderLevelLayer = {
			level: optimalLevel,
			zIndex: 1,
			isOptimal: true,
			levelSize: getLevelSize(dzi, optimalLevel),
			origin: computeLayerOrigin(readyOptimalTiles),
			tiles: readyOptimalTiles
		};
		return {
			layers: readyOptimalTiles.length > 0 ? [optimalLayer] : [],
			isOptimalLoaded: allOptimalReady,
			mountedTileKeys: new Set(readyOptimalTiles.map((tile) => tile.key))
		};
	}

	// Ready fallback tiles from every other level that intersect the current viewport, using the cache's level index.
	const fallbacksByLevel = new Map(
		Array.from(cache.getReadyTilesByLevel())
			.filter(([level]) => level !== optimalLevel)
			.map(([level, tiles]): [number, CachedTile[]] => [
				level,
				Array.from(tiles).filter((tile) =>
					rectIntersects(tile.stageRect, visibleBounds, COVERAGE_EPSILON)
				)
			])
			.filter(([, tiles]) => tiles.length > 0)
	);

	// Prefer already-loaded sharper levels (closest above optimal first) over coarser blurry levels
	// (closest below optimal first) so loaded high-resolution tiles appear immediately during zoom transitions.
	const sortedFallbackLevels = Array.from(fallbacksByLevel.keys()).sort((a, b) => {
		const aFiner = a > optimalLevel;
		const bFiner = b > optimalLevel;
		if (aFiner !== bFiner) {
			return aFiner ? -1 : 1;
		}
		return Math.abs(a - optimalLevel) - Math.abs(b - optimalLevel);
	});

	// Walk closest-to-farthest, stopping once 100% of uncovered optimal areas are covered by opaque tiles.
	const fallbackSelection = sortedFallbackLevels.reduce<{
		uncovered: Rect[];
		selected: Array<{ level: number; tiles: CachedTile[] }>;
	}>(
		(acc, level) => {
			if (acc.uncovered.length === 0) {
				return acc;
			}

			const candidates = fallbacksByLevel.get(level) ?? [];
			const needed = candidates.filter((tile) =>
				acc.uncovered.some((rect) => rectIntersects(tile.stageRect, rect, COVERAGE_EPSILON))
			);

			if (needed.length === 0) {
				return acc;
			}

			needed.forEach((tile) => cache.touch(tile.key));

			// Only opaque fallback tiles remove coverage from coarser levels beneath them.
			const opaqueCuts = mergeAdjacentRects(
				needed.filter((tile) => isOpaque(tile.key)).map((tile) => tile.stageRect)
			);

			return {
				uncovered: opaqueCuts.length > 0 ? subtractRects(acc.uncovered, opaqueCuts) : acc.uncovered,
				selected: [...acc.selected, { level, tiles: needed.sort(byGridPosition) }]
			};
		},
		{ uncovered: mergeAdjacentRects(uncoveredVisibleRects), selected: [] }
	);

	// Reverse so farthest fallback sits at the bottom and closest fallback sits directly under the optimal level.
	const orderedFallbacks: RenderLevelLayer[] = fallbackSelection.selected
		.reverse()
		.map((group, index) => ({
			level: group.level,
			zIndex: index + 1,
			isOptimal: false,
			levelSize: getLevelSize(dzi, group.level),
			origin: computeLayerOrigin(group.tiles),
			tiles: group.tiles
		}));

	const layers: RenderLevelLayer[] =
		readyOptimalTiles.length > 0
			? [
					...orderedFallbacks,
					{
						level: optimalLevel,
						zIndex: orderedFallbacks.length + 1,
						isOptimal: true,
						levelSize: getLevelSize(dzi, optimalLevel),
						origin: computeLayerOrigin(readyOptimalTiles),
						tiles: readyOptimalTiles
					}
				]
			: orderedFallbacks;

	const mountedTileKeys = new Set(layers.flatMap((layer) => layer.tiles.map((tile) => tile.key)));

	return {
		layers,
		isOptimalLoaded: allOptimalReady,
		mountedTileKeys
	};
}
