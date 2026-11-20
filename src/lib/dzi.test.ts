import { describe, expect, it } from 'vitest';
import {
	getClosestSingleTileLevel,
	getLevelGrid,
	getLevelSize,
	getMaxLevel,
	getTilePixelRect,
	getTileStageRect,
	getTileUrl,
	loadDzi,
	parseDziJson,
	parseDziXml,
	resolveTilesUrlFromDziUrl,
	tileExists
} from './dzi.js';

const SAMPLE_DZI_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Image xmlns="http://schemas.microsoft.com/deepzoom/2008" Format="jpg" Overlap="1" TileSize="256">
  <Size Width="4000" Height="3000"/>
</Image>`;

describe('DZI parsing and pyramid geometry', () => {
	it('derives tilesUrl and preserves query parameters from a DZI URL', () => {
		const resolved = resolveTilesUrlFromDziUrl(
			'https://www.abc.net.au/dat/news/zoomytellers/venice/kithandkinhero.dzi?v=2'
		);
		expect(resolved.tilesUrl).toBe(
			'https://www.abc.net.au/dat/news/zoomytellers/venice/kithandkinhero_files/'
		);
		expect(resolved.queryParams).toBe('?v=2');
	});

	it('parses DZI XML into a normalised descriptor', () => {
		const dzi = parseDziXml(SAMPLE_DZI_XML, {
			sourceUrl: 'https://example.com/images/venice.dzi'
		});
		expect(dzi.width).toBe(4000);
		expect(dzi.height).toBe(3000);
		expect(dzi.tileSize).toBe(256);
		expect(dzi.overlap).toBe(1);
		expect(dzi.format).toBe('jpg');
		expect(dzi.maxLevel).toBe(12);
		expect(dzi.tilesUrl).toBe('https://example.com/images/venice_files/');
		expect(getTileUrl(dzi, 10, 2, 3)).toBe('https://example.com/images/venice_files/10/2_3.jpg');
	});

	it('computes Deep Zoom integer-halved level sizes and grids', () => {
		expect(getMaxLevel(1000, 600)).toBe(10);
		const dzi = parseDziJson({
			Image: { Format: 'jpg', Overlap: 1, TileSize: 256, Size: { Width: 1000, Height: 600 } }
		});
		expect(getLevelSize(dzi, 10)).toEqual({ width: 1000, height: 600 });
		expect(getLevelSize(dzi, 9)).toEqual({ width: 500, height: 300 });
		expect(getLevelSize(dzi, 8)).toEqual({ width: 250, height: 150 });
		expect(getLevelSize(dzi, 6)).toEqual({ width: 63, height: 38 });
		expect(getLevelSize(dzi, 0)).toEqual({ width: 1, height: 1 });

		expect(getLevelGrid(dzi, 10)).toEqual({ cols: 4, rows: 3 });
		expect(getClosestSingleTileLevel(dzi)).toBe(8);
	});

	it('accounts for tile overlap and edge clamping in pixel rects', () => {
		const dzi = parseDziJson({
			Image: { Format: 'jpg', Overlap: 1, TileSize: 256, Size: { Width: 600, Height: 300 } }
		});
		// Level 10 is full 600x300 (3 cols x 2 rows)
		expect(getTilePixelRect(dzi, 10, 0, 0)).toEqual({ x: 0, y: 0, width: 257, height: 257 });
		expect(getTilePixelRect(dzi, 10, 1, 0)).toEqual({ x: 255, y: 0, width: 258, height: 257 });
		expect(getTilePixelRect(dzi, 10, 2, 0)).toEqual({ x: 511, y: 0, width: 89, height: 257 });
		expect(getTilePixelRect(dzi, 10, 0, 1)).toEqual({ x: 0, y: 255, width: 257, height: 45 });
	});

	it('computes non-overlapping logical stage rects that partition the image exactly', () => {
		const dzi = parseDziJson({
			Image: { Format: 'jpg', Overlap: 1, TileSize: 256, Size: { Width: 512, Height: 256 } }
		});
		const imageBounds = { x: 100, y: 50, width: 1000, height: 500 };
		const leftTile = getTileStageRect(dzi, 9, 0, 0, imageBounds);
		const rightTile = getTileStageRect(dzi, 9, 1, 0, imageBounds);

		expect(leftTile).toEqual({ x: 100, y: 50, width: 500, height: 500 });
		expect(rightTile).toEqual({ x: 600, y: 50, width: 500, height: 500 });
	});

	it('respects DisplayRects when checking tileExists', () => {
		const dzi = parseDziJson({
			Image: {
				Format: 'jpg',
				Overlap: 0,
				TileSize: 256,
				Size: { Width: 1024, Height: 1024 },
				DisplayRects: [
					{
						MinLevel: 10,
						MaxLevel: 10,
						Rect: { X: 0, Y: 0, Width: 512, Height: 512 }
					}
				]
			}
		});
		// Level 10 is constrained by DisplayRect to cols 0..1, rows 0..1
		expect(tileExists(dzi, 10, 0, 0)).toBe(true);
		expect(tileExists(dzi, 10, 1, 1)).toBe(true);
		expect(tileExists(dzi, 10, 2, 0)).toBe(false);
		// Level 9 has no DisplayRects, so all valid tiles exist
		expect(tileExists(dzi, 9, 1, 1)).toBe(true);
	});

	it('loads remote XML via custom fetch in loadDzi', async () => {
		const mockFetch = (() =>
			Promise.resolve(
				new Response(SAMPLE_DZI_XML, { status: 200 })
			)) as unknown as typeof globalThis.fetch;

		const dzi = await loadDzi('https://example.com/test.dzi', { fetch: mockFetch });
		expect(dzi.width).toBe(4000);
		expect(dzi.tilesUrl).toBe('https://example.com/test_files/');
	});
});
