import { describe, expect, it } from 'vitest';
import { limitTileChanges } from './mountBudget.js';
import type { CachedTile, RenderLevelLayer } from './types.js';

/** A 100×100 stage tile at grid position `col`, `row`, so its centre is at `col * 100 + 50`. */
function makeTile(level: number, col: number, row = 0): CachedTile {
	const rect = { x: col * 100, y: row * 100, width: 100, height: 100 };
	return {
		key: `src:${level}:${col}_${row}`,
		level,
		col,
		row,
		url: '',
		pixelRect: rect,
		stageRect: rect,
		status: 'ready',
		lastUsed: 0
	};
}

function makeLayer(
	level: number,
	tiles: CachedTile[],
	{ isOptimal = false, zIndex = 1 } = {}
): RenderLevelLayer {
	return {
		level,
		zIndex,
		isOptimal,
		levelSize: { width: 10_000, height: 10_000 },
		origin: { x: 0, y: 0 },
		tiles
	};
}

const keysByLevel = (layers: readonly RenderLevelLayer[]) =>
	Object.fromEntries(layers.map((layer) => [layer.level, layer.tiles.map((tile) => tile.key)]));

const centre = { x: 450, y: 50 };

describe('limitTileChanges', () => {
	it('adds optimal tiles before fallbacks, nearest the centre first, up to the limit', () => {
		const optimal = makeLayer(
			11,
			[0, 3, 4, 8].map((col) => makeTile(11, col)),
			{ isOptimal: true, zIndex: 2 }
		);
		const fallback = makeLayer(10, [makeTile(10, 4)]);

		const { layers, pending } = limitTileChanges({
			displayed: [],
			planned: [fallback, optimal],
			maxAdds: 2,
			maxRemoves: 4,
			viewportCentre: centre
		});

		// Columns 4 and 3 are nearest x = 450; the level 10 fallback waits behind every optimal tile.
		expect(keysByLevel(layers)).toEqual({ 11: ['src:11:3_0', 'src:11:4_0'] });
		expect(pending).toBe(true);
	});

	it('removes the farthest tiles first and keeps the rest in their layer', () => {
		const displayed = [
			makeLayer(
				11,
				[1, 4, 9].map((col) => makeTile(11, col)),
				{ isOptimal: true }
			)
		];
		const planned = [makeLayer(11, [makeTile(11, 4)], { isOptimal: true })];

		const { layers, pending } = limitTileChanges({
			displayed,
			planned,
			maxAdds: 8,
			maxRemoves: 1,
			viewportCentre: centre
		});

		// Tile 9 is farthest from x = 450, so it goes first; tile 1 lingers in level 11.
		expect(keysByLevel(layers)).toEqual({ 11: ['src:11:1_0', 'src:11:4_0'] });
		expect(pending).toBe(true);
	});

	it('keeps lingering tiles from a dropped level underneath everything, recomputing the layer origin', () => {
		const displayed = [makeLayer(12, [makeTile(12, 30), makeTile(12, 31)], { isOptimal: true })];
		const planned = [makeLayer(11, [makeTile(11, 4)], { isOptimal: true })];

		const { layers } = limitTileChanges({
			displayed,
			planned,
			maxAdds: 8,
			maxRemoves: 1,
			viewportCentre: centre
		});

		const lingering = layers.find((layer) => layer.level === 12);
		expect(lingering).toMatchObject({ zIndex: 0, isOptimal: false, origin: { x: 2048, y: 0 } });
		expect(lingering?.tiles.map((tile) => tile.key)).toEqual(['src:12:30_0']);
		expect(layers.at(-1)?.level).toBe(11);
	});

	it('converges on the plan within a few frames', () => {
		const planned = [
			makeLayer(
				11,
				Array.from({ length: 10 }, (_, col) => makeTile(11, col))
			)
		];
		let displayed: readonly RenderLevelLayer[] = [
			makeLayer(
				10,
				[0, 1, 2].map((col) => makeTile(10, col))
			)
		];
		let frames = 0;
		let pending = true;

		while (pending) {
			({ layers: displayed, pending } = limitTileChanges({
				displayed,
				planned,
				maxAdds: 4,
				maxRemoves: 2,
				viewportCentre: centre
			}));
			frames += 1;
		}

		// 10 adds at 4 per frame; the 3 old tiles go 2 then 1.
		expect(frames).toBe(3);
		expect(keysByLevel(displayed)).toEqual(keysByLevel(planned));
	});

	it('returns the plan untouched when the limit is off or nothing changes', () => {
		const planned = [makeLayer(11, [makeTile(11, 0)])];
		const unlimited = limitTileChanges({
			displayed: [],
			planned,
			maxAdds: Number.POSITIVE_INFINITY,
			maxRemoves: Number.POSITIVE_INFINITY,
			viewportCentre: centre
		});
		const unchanged = limitTileChanges({
			displayed: planned,
			planned,
			maxAdds: 1,
			maxRemoves: 1,
			viewportCentre: centre
		});

		expect(unlimited).toEqual({ layers: planned, pending: false });
		expect(unchanged.layers).toBe(planned);
	});
});
