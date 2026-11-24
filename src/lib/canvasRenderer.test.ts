import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	CanvasTileRenderer,
	computeBackingSize,
	computeTileDrawRect,
	SAFARI_MAX_CANVAS_PIXELS,
	type AnyCanvas
} from './canvasRenderer.js';
import type { DziDescriptor, Rect } from './types.js';

interface DrawCall {
	readonly bitmap: ImageBitmap;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly alpha: number;
}

interface StrokeCall {
	readonly strokeStyle: string;
	readonly lineWidth: number;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

function createFakeBitmap(label: string): ImageBitmap & { readonly label: string } {
	return {
		label,
		width: 256,
		height: 256,
		close: vi.fn()
	} as unknown as ImageBitmap & { readonly label: string };
}

function createMockCanvas() {
	const drawCalls: DrawCall[] = [];
	const strokeCalls: StrokeCall[] = [];
	const clearCalls: Array<readonly [number, number, number, number]> = [];

	const ctx = {
		globalAlpha: 1,
		imageSmoothingEnabled: true,
		strokeStyle: '',
		lineWidth: 1,
		clearRect(x: number, y: number, width: number, height: number) {
			clearCalls.push([x, y, width, height]);
		},
		drawImage(bitmap: ImageBitmap, x: number, y: number, width: number, height: number) {
			drawCalls.push({ bitmap, x, y, width, height, alpha: this.globalAlpha });
		},
		strokeRect(x: number, y: number, width: number, height: number) {
			strokeCalls.push({
				strokeStyle: String(this.strokeStyle),
				lineWidth: this.lineWidth,
				x,
				y,
				width,
				height
			});
		}
	};

	const canvas = {
		width: 0,
		height: 0,
		getContext: vi.fn((type: string) => (type === '2d' ? ctx : null))
	};

	return {
		canvas: canvas as unknown as AnyCanvas,
		rawCanvas: canvas,
		drawCalls,
		strokeCalls,
		clearCalls
	};
}

function makeDzi(overrides: Partial<DziDescriptor> = {}): DziDescriptor {
	return {
		width: 512,
		height: 512,
		tileSize: 256,
		overlap: 1,
		format: 'jpg',
		tilesUrl: 'https://example.com/image_files/',
		minLevel: 0,
		maxLevel: 9,
		...overrides
	};
}

function flushPromises(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('computeBackingSize', () => {
	it('returns zero size when container has zero dimensions', () => {
		expect(computeBackingSize({ width: 0, height: 600 }, 2)).toEqual({
			width: 0,
			height: 0,
			scale: 1
		});
	});

	it('scales container dimensions by dpr when under the pixel limit', () => {
		expect(computeBackingSize({ width: 800, height: 600 }, 2)).toEqual({
			width: 1600,
			height: 1200,
			scale: 2
		});
	});

	it('clamps backing dimensions to stay within Safari max canvas pixel area', () => {
		const result = computeBackingSize({ width: 4000, height: 3000 }, 2);
		expect(result.width * result.height).toBeLessThanOrEqual(SAFARI_MAX_CANVAS_PIXELS + 8192);
		expect(result.scale).toBeLessThan(2);
		expect(result.width / result.height).toBeCloseTo(4000 / 3000, 2);
	});
});

describe('computeTileDrawRect', () => {
	const imageBounds: Rect = { x: 0, y: 0, width: 512, height: 512 };
	const containerSize = { width: 512, height: 512 };

	it('preserves exact fractional coordinates when overlap is present (snapEdges = false)', () => {
		const rect = computeTileDrawRect({
			tile: { pixelRect: { x: 0, y: 0, width: 257, height: 257 } },
			layer: { levelSize: { width: 512, height: 512 } },
			imageBounds,
			viewport: { x: 256.3, y: 256.3, zoom: 1 },
			containerSize,
			backingScale: 1,
			snapEdges: false
		});

		expect(rect.x).toBeCloseTo(-0.3, 5);
		expect(rect.y).toBeCloseTo(-0.3, 5);
		expect(rect.width).toBeCloseTo(257, 5);
		expect(rect.height).toBeCloseTo(257, 5);
	});

	it('snaps tile edges outward when overlap is zero (snapEdges = true)', () => {
		const rect = computeTileDrawRect({
			tile: { pixelRect: { x: 0, y: 0, width: 256, height: 256 } },
			layer: { levelSize: { width: 512, height: 512 } },
			imageBounds,
			viewport: { x: 256.3, y: 256.3, zoom: 1 },
			containerSize,
			backingScale: 1,
			snapEdges: true
		});

		expect(rect).toEqual({ x: -1, y: -1, width: 257, height: 257 });
	});
});

describe('CanvasTileRenderer', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('draws fallback beneath optimal tiles, crossfades with globalAlpha, and drops covered fallbacks', async () => {
		const rafMock = vi.fn(() => 1);
		vi.stubGlobal('requestAnimationFrame', rafMock);
		vi.stubGlobal('cancelAnimationFrame', vi.fn());

		const { canvas, drawCalls } = createMockCanvas();
		const dzi = makeDzi();
		const imageBounds: Rect = { x: 0, y: 0, width: 512, height: 512 };
		const pending = new Map<string, () => void>();
		const optimalChanges: boolean[] = [];

		const renderer = new CanvasTileRenderer(
			canvas,
			{ onOptimalLoadedChange: (value) => optimalChanges.push(value) },
			{
				maxDpr: 1,
				tileFadeDuration: 200,
				preloadBaseLevel: true,
				loadImage: (url) =>
					new Promise((resolve) => {
						pending.set(url, () => resolve(createFakeBitmap(url)));
					})
			}
		);

		renderer.setContainerSize({ width: 512, height: 512 }, 1);
		renderer.setViewport({ x: 256, y: 256, zoom: 1 });
		renderer.setSource(dzi, imageBounds, 'src');

		// First pass queues base level (L8: 0_0) and optimal level (L9: 4 tiles).
		renderer.renderNow(1000);
		expect(drawCalls).toHaveLength(0);

		const baseUrl = 'https://example.com/image_files/8/0_0.jpg';
		expect(pending.has(baseUrl)).toBe(true);

		// Fallback base tile draws immediately at alpha=1 so placeholders never flash blank.
		pending.get(baseUrl)?.();
		await flushPromises();

		drawCalls.length = 0;
		renderer.renderNow(1000);
		expect(drawCalls).toHaveLength(1);
		expect((drawCalls[0].bitmap as unknown as { label: string }).label).toBe(baseUrl);
		expect(drawCalls[0].alpha).toBe(1);

		// Now resolve all four optimal tiles at L9.
		const optimalUrls = [
			'https://example.com/image_files/9/0_0.jpg',
			'https://example.com/image_files/9/1_0.jpg',
			'https://example.com/image_files/9/0_1.jpg',
			'https://example.com/image_files/9/1_1.jpg'
		];
		optimalUrls.forEach((url) => pending.get(url)?.());
		await flushPromises();

		// At t=2000 optimal tiles begin fading in (alpha=0) while the opaque base tile still draws underneath.
		drawCalls.length = 0;
		renderer.renderNow(2000);
		expect(drawCalls).toHaveLength(5);
		expect((drawCalls[0].bitmap as unknown as { label: string }).label).toBe(baseUrl);
		expect(drawCalls[0].alpha).toBe(1);
		expect(drawCalls.slice(1).every((call) => call.alpha === 0)).toBe(true);
		expect(optimalChanges.at(-1)).toBe(true);

		// Mid-fade at t=2100: optimal tiles at alpha=0.5, base still underneath, next frame scheduled.
		rafMock.mockClear();
		drawCalls.length = 0;
		renderer.renderNow(2100);
		expect(drawCalls).toHaveLength(5);
		expect(drawCalls.slice(1).every((call) => call.alpha === 0.5)).toBe(true);
		expect(rafMock).toHaveBeenCalledTimes(1);

		// Fade completes at t=2200: optimal tiles reach alpha=1 and schedule one follow-up frame to drop fallback.
		rafMock.mockClear();
		drawCalls.length = 0;
		renderer.renderNow(2200);
		expect(drawCalls.slice(1).every((call) => call.alpha === 1)).toBe(true);
		expect(rafMock).toHaveBeenCalledTimes(1);

		// Next frame drops the now-covered base fallback tile and stops scheduling frames.
		rafMock.mockClear();
		drawCalls.length = 0;
		renderer.renderNow(2216);
		expect(drawCalls).toHaveLength(4);
		expect(drawCalls.every((call) => call.alpha === 1)).toBe(true);
		expect(rafMock).not.toHaveBeenCalled();

		// Zooming back out to L8 draws the previously covered cached tile immediately at alpha=1.
		renderer.setViewport({ x: 256, y: 256, zoom: 0.5 });
		drawCalls.length = 0;
		renderer.renderNow(2300);
		expect(drawCalls).toHaveLength(1);
		expect((drawCalls[0].bitmap as unknown as { label: string }).label).toBe(baseUrl);
		expect(drawCalls[0].alpha).toBe(1);

		renderer.destroy();
	});

	it('draws immediately at alpha=1 when tileFadeDuration is 0 and outlines tiles in debug mode', async () => {
		vi.stubGlobal(
			'requestAnimationFrame',
			vi.fn(() => 1)
		);
		vi.stubGlobal('cancelAnimationFrame', vi.fn());

		const { canvas, drawCalls, strokeCalls } = createMockCanvas();
		const dzi = makeDzi({ width: 256, height: 256, maxLevel: 8 });
		const imageBounds: Rect = { x: 0, y: 0, width: 256, height: 256 };
		const bitmap = createFakeBitmap('tile');

		const renderer = new CanvasTileRenderer(
			canvas,
			{},
			{
				maxDpr: 1,
				tileFadeDuration: 0,
				debug: true,
				preloadBaseLevel: false,
				loadImage: () => Promise.resolve(bitmap)
			}
		);

		renderer.setContainerSize({ width: 256, height: 256 }, 1);
		renderer.setViewport({ x: 128, y: 128, zoom: 1 });
		renderer.setSource(dzi, imageBounds, 'src');

		renderer.renderNow(0);
		await flushPromises();

		drawCalls.length = 0;
		strokeCalls.length = 0;
		renderer.renderNow(0);

		expect(drawCalls).toHaveLength(1);
		expect(drawCalls[0].alpha).toBe(1);
		expect(strokeCalls).toHaveLength(1);
		expect(strokeCalls[0].strokeStyle).toBe('limegreen');

		renderer.destroy();
	});

	it('closes all cached bitmaps and shrinks the canvas to 1×1 on destroy', async () => {
		vi.stubGlobal(
			'requestAnimationFrame',
			vi.fn(() => 1)
		);
		vi.stubGlobal('cancelAnimationFrame', vi.fn());

		const { canvas, rawCanvas } = createMockCanvas();
		const dzi = makeDzi({ width: 256, height: 256, maxLevel: 8 });
		const imageBounds: Rect = { x: 0, y: 0, width: 256, height: 256 };
		const bitmap = createFakeBitmap('tile');

		const renderer = new CanvasTileRenderer(
			canvas,
			{},
			{
				maxDpr: 1,
				preloadBaseLevel: false,
				loadImage: () => Promise.resolve(bitmap)
			}
		);

		renderer.setContainerSize({ width: 400, height: 300 }, 2);
		renderer.setViewport({ x: 128, y: 128, zoom: 1 });
		renderer.setSource(dzi, imageBounds, 'src');

		expect(rawCanvas.width).toBe(800);
		expect(rawCanvas.height).toBe(600);

		renderer.renderNow(0);
		await flushPromises();
		renderer.renderNow(0);

		renderer.destroy();

		expect(bitmap.close).toHaveBeenCalledTimes(1);
		expect(rawCanvas.width).toBe(1);
		expect(rawCanvas.height).toBe(1);
	});

	it('notifies the render surface when tiles are evicted or cleared', async () => {
		vi.stubGlobal(
			'requestAnimationFrame',
			vi.fn(() => 1)
		);
		vi.stubGlobal('cancelAnimationFrame', vi.fn());

		const { canvas } = createMockCanvas();
		const uploaded = new Set<string>();
		const surface = {
			kind: 'webgl' as const,
			resize: vi.fn(),
			clear: vi.fn(),
			beginFrame: vi.fn(),
			hasTile: vi.fn((key: string) => uploaded.has(key)),
			uploadTile: vi.fn((key: string) => {
				uploaded.add(key);
			}),
			drawTile: vi.fn(),
			drawDebugOutline: vi.fn(),
			endFrame: vi.fn(),
			evictTile: vi.fn((key: string) => {
				uploaded.delete(key);
			}),
			clearTiles: vi.fn(() => uploaded.clear()),
			destroy: vi.fn()
		};

		const dzi = makeDzi({ width: 256, height: 256, maxLevel: 8 });
		const imageBounds: Rect = { x: 0, y: 0, width: 256, height: 256 };
		const bitmap = createFakeBitmap('tile');

		const renderer = new CanvasTileRenderer(
			canvas,
			{},
			{
				maxDpr: 1,
				tileFadeDuration: 0,
				preloadBaseLevel: false,
				surface,
				loadImage: () => Promise.resolve(bitmap)
			}
		);

		renderer.setContainerSize({ width: 256, height: 256 }, 1);
		renderer.setViewport({ x: 128, y: 128, zoom: 1 });
		renderer.setSource(dzi, imageBounds, 'src-1');

		renderer.renderNow(0);
		await flushPromises();
		renderer.renderNow(0);

		expect(surface.drawTile).toHaveBeenCalledTimes(1);
		// WebGL surfaces release the CPU-side ImageBitmap immediately once uploaded to a GPU texture.
		expect(bitmap.close).toHaveBeenCalledTimes(1);

		// Clearing the source clears both engine tile cache entries and surface GPU textures.
		renderer.setSource(null, null, 'src-2');
		expect(surface.clearTiles).toHaveBeenCalled();

		renderer.destroy();
		expect(surface.destroy).toHaveBeenCalledTimes(1);
	});

	it('spreads GPU texture uploads across frames within uploadBudgetMs while keeping fallbacks visible', async () => {
		const rafMock = vi.fn(() => 1);
		vi.stubGlobal('requestAnimationFrame', rafMock);
		vi.stubGlobal('cancelAnimationFrame', vi.fn());

		const { canvas } = createMockCanvas();
		let clock = 0;
		const uploaded = new Set<string>();
		const drawnKeysPerFrame: string[][] = [];
		let currentFrameKeys: string[] = [];

		const surface = {
			kind: 'webgl' as const,
			resize: vi.fn(),
			clear: vi.fn(),
			beginFrame: vi.fn(() => {
				currentFrameKeys = [];
			}),
			hasTile: (key: string) => uploaded.has(key),
			uploadTile: vi.fn((key: string) => {
				clock += 2.5;
				uploaded.add(key);
			}),
			drawTile: vi.fn((key: string) => {
				currentFrameKeys.push(key);
			}),
			drawDebugOutline: vi.fn(),
			endFrame: vi.fn(() => {
				drawnKeysPerFrame.push(currentFrameKeys);
			}),
			evictTile: vi.fn((key: string) => uploaded.delete(key)),
			clearTiles: vi.fn(() => uploaded.clear()),
			destroy: vi.fn()
		};

		const dzi = makeDzi();
		const imageBounds: Rect = { x: 0, y: 0, width: 512, height: 512 };
		const optimalStates: boolean[] = [];

		const renderer = new CanvasTileRenderer(
			canvas,
			{ onOptimalLoadedChange: (value) => optimalStates.push(value) },
			{
				maxDpr: 1,
				tileFadeDuration: 0,
				preloadBaseLevel: true,
				uploadBudgetMs: 4,
				surface,
				now: () => clock,
				loadImage: (url) => Promise.resolve(createFakeBitmap(url))
			}
		);

		renderer.setContainerSize({ width: 512, height: 512 }, 1);
		renderer.setViewport({ x: 256, y: 256, zoom: 1 });
		renderer.setSource(dzi, imageBounds, 'src');

		// Queue and decode all 5 tiles (1 base fallback + 4 optimal) in one burst.
		renderer.renderNow(0);
		await flushPromises();

		// Frame 1: budget (4ms) allows 2 uploads (2.5ms each) — fallback base tile first + 1 optimal tile.
		rafMock.mockClear();
		surface.uploadTile.mockClear();
		renderer.renderNow(16);
		expect(surface.uploadTile).toHaveBeenCalledTimes(2);
		expect(drawnKeysPerFrame.at(-1)).toHaveLength(2);
		expect(drawnKeysPerFrame.at(-1)?.[0]).toBe('src:8:0_0');
		expect(optimalStates.at(-1)).not.toBe(true);
		expect(rafMock).toHaveBeenCalledTimes(1);

		// Frame 2: next 2 optimal tiles upload while fallback stays underneath for the remaining quadrant.
		rafMock.mockClear();
		surface.uploadTile.mockClear();
		renderer.renderNow(32);
		expect(surface.uploadTile).toHaveBeenCalledTimes(2);
		expect(drawnKeysPerFrame.at(-1)).toHaveLength(4);
		expect(optimalStates.at(-1)).not.toBe(true);
		expect(rafMock).toHaveBeenCalledTimes(1);

		// Frame 3: final optimal tile uploads; all 4 optimal tiles draw and `isOptimalLoaded` becomes true.
		rafMock.mockClear();
		surface.uploadTile.mockClear();
		renderer.renderNow(48);
		expect(surface.uploadTile).toHaveBeenCalledTimes(1);
		expect(drawnKeysPerFrame.at(-1)).toHaveLength(5);
		expect(optimalStates.at(-1)).toBe(true);
		expect(rafMock).toHaveBeenCalledTimes(1);

		// Frame 4: now-covered fallback drops cleanly and no further frames are scheduled.
		rafMock.mockClear();
		surface.uploadTile.mockClear();
		renderer.renderNow(64);
		expect(surface.uploadTile).not.toHaveBeenCalled();
		expect(drawnKeysPerFrame.at(-1)).toHaveLength(4);
		expect(rafMock).not.toHaveBeenCalled();

		renderer.destroy();
	});
});
