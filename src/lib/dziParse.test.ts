import { describe, expect, it } from 'vitest';
import { getTileUrl } from './pyramid.js';
import { loadDzi, parseDziXml, resolveTilesUrlFromDziUrl } from './dziParse.js';

const SAMPLE_DZI_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Image xmlns="http://schemas.microsoft.com/deepzoom/2008" Format="jpg" Overlap="1" TileSize="256">
  <Size Width="4000" Height="3000"/>
</Image>`;

describe('DZI parsing', () => {
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

	it('loads remote XML via custom fetch in loadDzi', async () => {
		const mockFetch = (() =>
			Promise.resolve(
				new Response(SAMPLE_DZI_XML, { status: 200 })
			)) as unknown as typeof globalThis.fetch;

		const dzi = await loadDzi('https://example.com/test.dzi', { fetch: mockFetch });
		expect(dzi.width).toBe(4000);
		expect(dzi.tilesUrl).toBe('https://example.com/test_files/');
	});

	it('reads DisplayRects from XML', () => {
		const dzi =
			parseDziXml(`<Image xmlns="http://schemas.microsoft.com/deepzoom/2008" Format="png" Overlap="0" TileSize="254">
  <Size Width="1024" Height="512"/>
  <DisplayRects>
    <DisplayRect MinLevel="8" MaxLevel="10"><Rect X="0" Y="0" Width="512" Height="512"/></DisplayRect>
  </DisplayRects>
</Image>`);
		expect(dzi.format).toBe('png');
		expect(dzi.displayRects).toEqual([
			{ x: 0, y: 0, width: 512, height: 512, minLevel: 8, maxLevel: 10 }
		]);
	});

	it('rejects XML without an <Image> root', () => {
		expect(() => parseDziXml('<Foo/>')).toThrow(/root element must be <Image>/);
	});
});
