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

	// Group ready fallback tiles from all other levels that intersect the current viewport.
	const fallbacksByLevel = cache
		.getReadyTiles()
		.filter(
			(tile) =>
				tile.level !== optimalLevel &&
				rectIntersects(tile.stageRect, visibleBounds, COVERAGE_EPSILON)
		)
		.reduce((map, tile) => {
			const group = map.get(tile.level) ?? [];
			group.push(tile);
			map.set(tile.level, group);
			return map;
		}, new Map<number, CachedTile[]>());

	// Prefer fallback levels closest in resolution to the optimal level; break ties in favour of sharper levels.
	const sortedFallbackLevels = Array.from(fallbacksByLevel.keys()).sort((a, b) => {
		const diff = Math.abs(a - optimalLevel) - Math.abs(b - optimalLevel);
		if (diff !== 0) {
			return diff;
		}
		return b - a;
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
			const opaqueCuts = needed.filter((tile) => isOpaque(tile.key)).map((tile) => tile.stageRect);

			return {
				uncovered: opaqueCuts.length > 0 ? subtractRects(acc.uncovered, opaqueCuts) : acc.uncovered,
				selected: [...acc.selected, { level, tiles: needed }]
			};
		},
		{ uncovered: uncoveredVisibleRects, selected: [] }
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
