import { describe, expect, it } from 'vitest';
import { parseDziJson } from './dziParse.js';
import { computeRenderPlan, mergeAdjacentRects, subtractRect } from './retention.js';
import { TileCache } from './tileCache.js';
import { getTilesForViewport } from './tiling.js';

const DZI = parseDziJson(
	{
		Image: { Format: 'jpg', Overlap: 0, TileSize: 256, Size: { Width: 1024, Height: 1024 } }
	},
	{ tilesUrl: 'https://example.com/dzi_files/' }
);

const IMAGE_BOUNDS = { x: 0, y: 0, width: 1024, height: 1024 };

describe('coverage subtraction and zero-blank fallback retention', () => {
	it('subtracts an intersecting rectangle into remaining non-overlapping strips', () => {
		const remaining = subtractRect(
			{ x: 0, y: 0, width: 100, height: 100 },
			{ x: 25, y: 25, width: 50, height: 50 }
		);
		const totalArea = remaining.reduce((sum, rect) => sum + rect.width * rect.height, 0);
		expect(totalArea).toBeCloseTo(100 * 100 - 50 * 50);
	});

	it('merges a grid of touching rectangles into one, and leaves separate ones alone', () => {
		const grid = [0, 1, 2].flatMap((row) =>
			[0, 1, 2].map((col) => ({ x: col * 10, y: row * 10, width: 10, height: 10 }))
		);
		const apart = { x: 50, y: 0, width: 10, height: 10 };

		expect(mergeAdjacentRects([...grid.reverse(), apart])).toEqual([
			{ x: 0, y: 0, width: 30, height: 30 },
			apart
		]);
	});

	it('keeps an L-shape as two rectangles covering the same area', () => {
		const lShape = [
			{ x: 0, y: 0, width: 10, height: 10 },
			{ x: 10, y: 0, width: 10, height: 10 },
			{ x: 0, y: 10, width: 10, height: 10 }
		];
		const merged = mergeAdjacentRects(lShape);
		const area = merged.reduce((sum, rect) => sum + rect.width * rect.height, 0);

		expect(merged).toHaveLength(2);
		expect(area).toBe(300);
	});

	it('retains coarser under-zoom fallback tiles until 100% of optimal tiles are decoded', () => {
		const cache = new TileCache();

		// Pre-populate level 8 (single 256x256 tile covering entire 1024x1024 image)
		const baseSelection = getTilesForViewport({
			dzi: DZI,
			imageBounds: IMAGE_BOUNDS,
			viewport: { x: 512, y: 512, zoom: 0.25 },
			containerSize: { width: 256, height: 256 },
			levelOverride: 8
		});
		baseSelection.tiles.forEach((spec) => cache.setReady(spec));

		// Zoom in to level 9 (2x2 tiles covering 1024x1024), only 2 of 4 tiles decoded so far
		const zoomedSelection = getTilesForViewport({
			dzi: DZI,
			imageBounds: IMAGE_BOUNDS,
			viewport: { x: 512, y: 512, zoom: 0.5 },
			containerSize: { width: 512, height: 512 },
			levelOverride: 9
		});
		expect(zoomedSelection.tiles).toHaveLength(4);
		cache.setReady(zoomedSelection.tiles[0]);
		cache.setReady(zoomedSelection.tiles[1]);

		const partialPlan = computeRenderPlan({
			dzi: DZI,
			optimalLevel: 9,
			optimalTiles: zoomedSelection.tiles,
			visibleBounds: zoomedSelection.visibleBounds,
			cache
		});

		expect(partialPlan.isOptimalLoaded).toBe(false);
		expect(partialPlan.layers.map((l) => l.level)).toEqual([8, 9]);
		expect(partialPlan.layers[0]?.isOptimal).toBe(false);
		expect(partialPlan.layers[1]?.isOptimal).toBe(true);

		// Once remaining optimal tiles finish decoding, the fallback level is cleanly removed
		cache.setReady(zoomedSelection.tiles[2]);
		cache.setReady(zoomedSelection.tiles[3]);

		const completePlan = computeRenderPlan({
			dzi: DZI,
			optimalLevel: 9,
			optimalTiles: zoomedSelection.tiles,
			visibleBounds: zoomedSelection.visibleBounds,
			cache
		});

		expect(completePlan.isOptimalLoaded).toBe(true);
		expect(completePlan.layers.map((l) => l.level)).toEqual([9]);
	});

	it('reuses finer over-zoom tiles plus coarser base tile when zooming out', () => {
		const cache = new TileCache();

		// Coarse level 8 single tile covering entire image
		const baseSelection = getTilesForViewport({
			dzi: DZI,
			imageBounds: IMAGE_BOUNDS,
			viewport: { x: 512, y: 512, zoom: 0.25 },
			containerSize: { width: 256, height: 256 },
			levelOverride: 8
		});
		baseSelection.tiles.forEach((spec) => cache.setReady(spec));

		// Previously viewed central tiles at level 10 (over-zoom relative to level 9)
		const highResSelection = getTilesForViewport({
			dzi: DZI,
			imageBounds: IMAGE_BOUNDS,
			viewport: { x: 512, y: 512, zoom: 1 },
			containerSize: { width: 512, height: 512 },
			levelOverride: 10
		});
		highResSelection.tiles.forEach((spec) => cache.setReady(spec));

		// Now zoom out to level 9 (none of level 9 tiles decoded yet)
		const zoomedOutSelection = getTilesForViewport({
			dzi: DZI,
			imageBounds: IMAGE_BOUNDS,
			viewport: { x: 512, y: 512, zoom: 0.5 },
			containerSize: { width: 512, height: 512 },
			levelOverride: 9
		});

		const plan = computeRenderPlan({
			dzi: DZI,
			optimalLevel: 9,
			optimalTiles: zoomedOutSelection.tiles,
			visibleBounds: zoomedOutSelection.visibleBounds,
			cache
		});

		expect(plan.isOptimalLoaded).toBe(false);
		// Level 8 sits at the bottom covering margins; sharper level 10 sits above it in the centre.
		expect(plan.layers.map((l) => l.level)).toEqual([8, 10]);
	});

	it('prefers already-loaded sharper tiles over closer coarser tiles while zooming in', () => {
		const largerDzi = parseDziJson(
			{
				Image: { Format: 'jpg', Overlap: 0, TileSize: 256, Size: { Width: 2048, Height: 2048 } }
			},
			{ tilesUrl: 'https://example.com/dzi_files/' }
		);
		const largerBounds = { x: 0, y: 0, width: 2048, height: 2048 };
		const cache = new TileCache();

		// Coarse level 8 (1 tile) covering the entire image, already mounted and opaque.
		const coarseSelection = getTilesForViewport({
			dzi: largerDzi,
			imageBounds: largerBounds,
			viewport: { x: 1024, y: 1024, zoom: 0.125 },
			containerSize: { width: 256, height: 256 },
			levelOverride: 8
		});
		coarseSelection.tiles.forEach((spec) => cache.setReady(spec));

		// Preloaded destination tiles at level 11 (3 levels above coarse, 2 levels above optimal level 9).
		const sharpSelection = getTilesForViewport({
			dzi: largerDzi,
			imageBounds: largerBounds,
			viewport: { x: 1024, y: 1024, zoom: 1 },
			containerSize: { width: 512, height: 512 },
			levelOverride: 11
		});
		sharpSelection.tiles.forEach((spec) => cache.setReady(spec));

		// Mid-zoom at optimal level 9 (not loaded yet): level 8 is 1 level below, level 11 is 2 levels above.
		const midZoomSelection = getTilesForViewport({
			dzi: largerDzi,
			imageBounds: largerBounds,
			viewport: { x: 1024, y: 1024, zoom: 0.25 },
			containerSize: { width: 512, height: 512 },
			levelOverride: 9
		});

		const opaqueKeys = new Set<string>(coarseSelection.tiles.map((tile) => tile.key));
		const plan = computeRenderPlan({
			dzi: largerDzi,
			optimalLevel: 9,
			optimalTiles: midZoomSelection.tiles,
			visibleBounds: midZoomSelection.visibleBounds,
			cache,
			opaqueTileKeys: opaqueKeys
		});

		// Level 11 renders above level 8 instead of being masked by the closer-but-coarser level 8 tile.
		expect(plan.layers.map((layer) => layer.level)).toEqual([8, 11]);
	});

	it('keeps underlying fallback tiles mounted while optimal tiles are still fading in', () => {
		const cache = new TileCache();

		const baseSelection = getTilesForViewport({
			dzi: DZI,
			imageBounds: IMAGE_BOUNDS,
			viewport: { x: 512, y: 512, zoom: 0.25 },
			containerSize: { width: 256, height: 256 },
			levelOverride: 8
		});
		baseSelection.tiles.forEach((spec) => cache.setReady(spec));

		const zoomedSelection = getTilesForViewport({
			dzi: DZI,
			imageBounds: IMAGE_BOUNDS,
			viewport: { x: 512, y: 512, zoom: 0.5 },
			containerSize: { width: 512, height: 512 },
			levelOverride: 9
		});
		zoomedSelection.tiles.forEach((spec) => cache.setReady(spec));

		// Base tile is already opaque, but level 9 tiles have just mounted and are mid-fade.
		const opaqueKeys = new Set<string>(baseSelection.tiles.map((t) => t.key));

		const fadingPlan = computeRenderPlan({
			dzi: DZI,
			optimalLevel: 9,
			optimalTiles: zoomedSelection.tiles,
			visibleBounds: zoomedSelection.visibleBounds,
			cache,
			opaqueTileKeys: opaqueKeys
		});

		expect(fadingPlan.isOptimalLoaded).toBe(true);
		expect(fadingPlan.layers.map((l) => l.level)).toEqual([8, 9]);

		// Once all level 9 tiles finish fading in, level 8 underneath is removed cleanly.
		zoomedSelection.tiles.forEach((spec) => opaqueKeys.add(spec.key));

		const fadedPlan = computeRenderPlan({
			dzi: DZI,
			optimalLevel: 9,
			optimalTiles: zoomedSelection.tiles,
			visibleBounds: zoomedSelection.visibleBounds,
			cache,
			opaqueTileKeys: opaqueKeys
		});

		expect(fadedPlan.isOptimalLoaded).toBe(true);
		expect(fadedPlan.layers.map((l) => l.level)).toEqual([9]);
	});

	it('keeps tiles in grid order while the viewport pans, so DOM nodes never need reordering', () => {
		const cache = new TileCache();
		const viewportAt = (x: number) =>
			getTilesForViewport({
				dzi: DZI,
				imageBounds: IMAGE_BOUNDS,
				viewport: { x, y: 512, zoom: 1 },
				containerSize: { width: 512, height: 512 },
				levelOverride: 10
			});

		const left = viewportAt(400);
		const right = viewportAt(624);
		[...left.tiles, ...right.tiles].forEach((spec) => cache.setReady(spec));

		const tileKeysFor = (selection: ReturnType<typeof viewportAt>) =>
			computeRenderPlan({
				dzi: DZI,
				optimalLevel: 10,
				optimalTiles: selection.tiles,
				visibleBounds: selection.visibleBounds,
				cache
			}).layers.flatMap((layer) => layer.tiles.map((tile) => tile.key));

		// The loader's centre-out order differs between the two viewports...
		expect(left.tiles.map((tile) => tile.key)).not.toEqual(
			right.tiles.map((tile) => tile.key).filter((key) => left.tiles.some((t) => t.key === key))
		);
		// ...but tiles both viewports share keep the same relative order in the render plan.
		const leftKeys = tileKeysFor(left);
		const rightKeys = tileKeysFor(right);
		const shared = leftKeys.filter((key) => rightKeys.includes(key));
		expect(shared.length).toBeGreaterThan(1);
		expect(rightKeys.filter((key) => shared.includes(key))).toEqual(shared);
	});
});
