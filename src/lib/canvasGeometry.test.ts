import { describe, expect, it } from 'vitest';
import {
	computeBackingSize,
	computeTileDrawRect,
	SAFARI_MAX_CANVAS_PIXELS
} from './canvasGeometry.js';
import type { Rect } from './types.js';

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
