import { describe, expect, it } from 'vitest';
import { parseDziJson } from './dzi.js';
import { clampDpr, DEFAULT_MAX_DPR, getOptimalLevel, getTilesForViewport } from './tiling.js';

const SAMPLE_DZI = parseDziJson(
	{
		Image: { Format: 'jpg', Overlap: 1, TileSize: 256, Size: { Width: 4096, Height: 4096 } }
	},
	{ tilesUrl: 'https://example.com/sample_files/' }
);

describe('optimal level selection and tile culling', () => {
	const imageBounds = { x: 0, y: 0, width: 4096, height: 4096 };

	it('selects the smallest level meeting screen density', () => {
		// Rendered width 1024 at DPR 1 => level 10 (1024x1024)
		expect(getOptimalLevel(SAMPLE_DZI, imageBounds, 0.25, 1)).toBe(10);
		// Same viewport on DPR 2 Retina display => level 11 (2048x2048)
		expect(getOptimalLevel(SAMPLE_DZI, imageBounds, 0.25, 2)).toBe(11);
		// Over-zoomed past 1:1 native pixels clamps to maxLevel (12)
		expect(getOptimalLevel(SAMPLE_DZI, imageBounds, 4, 2)).toBe(12);
	});

	it('caps DPR at 1.5 by default when computing viewport tiles', () => {
		expect(DEFAULT_MAX_DPR).toBe(1.5);
		expect(clampDpr(2)).toBe(1.5);
		expect(clampDpr(1)).toBe(1);

		// Rendered image width is 640px (4096 * 0.15625).
		// Uncapped DPR 2 would ask for 1280px (level 11); capped at 1.5 it asks for 960px (level 10).
		const result = getTilesForViewport({
			dzi: SAMPLE_DZI,
			imageBounds,
			viewport: { x: 2048, y: 2048, zoom: 640 / 4096 },
			containerSize: { width: 640, height: 640 },
			dpr: 2
		});
		expect(result.level).toBe(10);
	});

	it('culls tiles strictly to the visible viewport and sorts centre-first', () => {
		const result = getTilesForViewport({
			dzi: SAMPLE_DZI,
			imageBounds,
			viewport: { x: 512, y: 512, zoom: 1 },
			containerSize: { width: 512, height: 512 },
			dpr: 1
		});

		// At zoom 1, rendered size is 4096 => level 12 (tileSize 256).
		// Visible region is [256..768] x [256..768] => cols 1..2, rows 1..2 (4 tiles).
		expect(result.level).toBe(12);
		expect(result.tiles).toHaveLength(4);
		const coords = result.tiles.map((t) => `${t.col}_${t.row}`).sort();
		expect(coords).toEqual(['1_1', '1_2', '2_1', '2_2']);
	});

	it('orders tiles closest to the viewport centre first', () => {
		const result = getTilesForViewport({
			dzi: SAMPLE_DZI,
			imageBounds,
			viewport: { x: 400, y: 400, zoom: 1 },
			containerSize: { width: 700, height: 700 },
			dpr: 1
		});

		expect(result.tiles[0]?.col).toBe(1);
		expect(result.tiles[0]?.row).toBe(1);
		const distances = result.tiles.map((t) => t.distanceSq);
		const sortedDistances = [...distances].sort((a, b) => a - b);
		expect(distances).toEqual(sortedDistances);
	});

	it('caps the level at maxLevel when zooming in, but still drops lower when zooming out', () => {
		const viewAtZoom = (zoom: number) =>
			getTilesForViewport({
				dzi: SAMPLE_DZI,
				imageBounds,
				viewport: { x: 2048, y: 2048, zoom },
				containerSize: { width: 512, height: 512 },
				dpr: 1,
				maxLevel: 10
			});

		// Zoom 1 would pick level 12; the hold keeps it at 10.
		expect(viewAtZoom(1).level).toBe(10);
		// Zoom 0.125 picks level 9 on its own, below the cap.
		expect(viewAtZoom(0.125).level).toBe(9);
	});

	it('returns the same tile details for repeated frames, with only distance recalculated', () => {
		const frame = (x: number) =>
			getTilesForViewport({
				dzi: SAMPLE_DZI,
				imageBounds,
				viewport: { x, y: 512, zoom: 1 },
				containerSize: { width: 512, height: 512 },
				dpr: 1
			});
		const first = frame(512).tiles.find((t) => t.key === 'default:12:1_1');
		const second = frame(520).tiles.find((t) => t.key === 'default:12:1_1');

		expect(second?.pixelRect).toBe(first?.pixelRect);
		expect(second?.stageRect).toBe(first?.stageRect);
		expect(second?.distanceSq).not.toBe(first?.distanceSq);
	});

	it('returns an empty tile list when the viewport is completely outside imageBounds', () => {
		const result = getTilesForViewport({
			dzi: SAMPLE_DZI,
			imageBounds,
			viewport: { x: 10000, y: 10000, zoom: 1 },
			containerSize: { width: 500, height: 500 }
		});
		expect(result.tiles).toHaveLength(0);
	});
});
