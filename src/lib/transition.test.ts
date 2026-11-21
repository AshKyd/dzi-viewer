import { describe, expect, it } from 'vitest';
import {
	easeOutCubic,
	findTrackSegment,
	interpolateTarget,
	interpolateViewport,
	isViewportTargetExplicit,
	resolveViewportTarget,
	sampleViewportTrack
} from './transition.js';
import type { ViewportTrackStop } from './types.js';

describe('transition utilities', () => {
	const imageBounds = { x: 0, y: 0, width: 2000, height: 1000 };
	const containerSize = { width: 1000, height: 1000 };

	it('identifies explicit viewports vs bounds targets and resolvers', () => {
		expect(isViewportTargetExplicit({ x: 10, y: 20, zoom: 1 })).toBe(true);
		expect(isViewportTargetExplicit('fit')).toBe(false);
		expect(isViewportTargetExplicit('fill')).toBe(false);
		expect(isViewportTargetExplicit({ bounds: imageBounds, mode: 'fit' })).toBe(false);
		expect(isViewportTargetExplicit(() => ({ x: 0, y: 0, zoom: 1 }))).toBe(false);
	});

	it('resolves fit, fill, bounds, explicit, and resolver targets', () => {
		expect(resolveViewportTarget('fit', imageBounds, containerSize)).toEqual({
			x: 1000,
			y: 500,
			zoom: 0.5
		});
		expect(resolveViewportTarget('fill', imageBounds, containerSize)).toEqual({
			x: 1000,
			y: 500,
			zoom: 1
		});
		expect(
			resolveViewportTarget(
				{ bounds: { x: 0, y: 0, width: 500, height: 500 }, mode: 'fit', padding: 100 },
				imageBounds,
				containerSize
			)
		).toEqual({ x: 250, y: 250, zoom: 1.6 });

		const explicit = { x: 123, y: 456, zoom: 2.5 };
		expect(resolveViewportTarget(explicit, imageBounds, containerSize)).toBe(explicit);

		expect(
			resolveViewportTarget(
				({ imageBounds: bounds, containerSize: size }) => ({
					x: bounds.width * 0.25,
					y: bounds.height * 0.5,
					zoom: size.width / bounds.width
				}),
				imageBounds,
				containerSize
			)
		).toEqual({ x: 500, y: 500, zoom: 0.5 });
	});

	it('interpolates direct curve with exponential zoom and inverse-zoom-weighted pan', () => {
		const from = { x: 0, y: 0, zoom: 1 };
		const to = { x: 1000, y: 500, zoom: 4 };

		expect(interpolateViewport(from, to, -0.5)).toEqual(from);
		expect(interpolateViewport(from, to, 1.5)).toEqual(to);

		const mid = interpolateViewport(from, to, 0.5);
		// Geometric midpoint of zoom 1 -> 4 is 2.
		expect(mid.zoom).toBeCloseTo(2);
		// Inverse-zoom progress at zoom=2 between 1 and 4 is (1/2 - 1) / (1/4 - 1) = 2/3.
		expect(mid.x).toBeCloseTo(1000 * (2 / 3));
		expect(mid.y).toBeCloseTo(500 * (2 / 3));
	});

	it('falls back to linear pan when direct zoom is unchanged', () => {
		const from = { x: 100, y: 200, zoom: 2 };
		const to = { x: 500, y: 600, zoom: 2 };
		const mid = interpolateViewport(from, to, 0.5);

		expect(mid).toEqual({ x: 300, y: 400, zoom: 2 });
	});

	it('interpolates fly curve via d3-interpolate and zooms out between distant targets', () => {
		const from = { x: 100, y: 100, zoom: 4 };
		const to = { x: 1900, y: 900, zoom: 4 };

		const start = interpolateViewport(from, to, 0, { curve: 'fly', containerSize });
		const mid = interpolateViewport(from, to, 0.5, { curve: 'fly', containerSize });
		const end = interpolateViewport(from, to, 1, { curve: 'fly', containerSize });
		const steeper = interpolateViewport(from, to, 0.5, { curve: 'fly', containerSize, rho: 2 });

		expect(start).toEqual(from);
		expect(end).toEqual(to);
		// Van Wijk & Nuij arcs out (lower zoom) midway between two distant zoomed-in points.
		expect(mid.zoom).toBeLessThan(from.zoom);
		expect(mid.x).toBeCloseTo(1000, 0);
		expect(mid.y).toBeCloseTo(500, 0);
		// Higher rho increases curvature (zooms out further at midpoint).
		expect(steeper.zoom).toBeLessThan(mid.zoom);
	});

	it('applies custom easing in interpolateViewport and easeOutCubic matches cubic-out', () => {
		expect(easeOutCubic(0)).toBe(0);
		expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
		expect(easeOutCubic(1)).toBe(1);

		const from = { x: 0, y: 0, zoom: 1 };
		const to = { x: 1000, y: 0, zoom: 1 };
		const eased = interpolateViewport(from, to, 0.5, { easing: easeOutCubic });
		expect(eased.x).toBeCloseTo(875);
	});

	it('resolves and interpolates target pairs via interpolateTarget', () => {
		const detail = { bounds: { x: 500, y: 250, width: 500, height: 500 }, mode: 'fit' as const };
		const mid = interpolateTarget('fit', detail, imageBounds, containerSize, 0.5);
		// fit zoom is 0.5, detail zoom is 2 -> geometric midpoint is 1.
		expect(mid.zoom).toBeCloseTo(1);
	});

	it('finds track segments and clamps outside stop bounds', () => {
		expect(findTrackSegment([], 0.5)).toBeNull();

		const stops: ViewportTrackStop[] = [
			{ at: 0, target: 'fit' },
			{ at: 0.4, target: { bounds: { x: 0, y: 0, width: 500, height: 500 } } },
			{ at: 1, target: 'fill' }
		];

		expect(findTrackSegment(stops, -1)).toMatchObject({
			fromIndex: 0,
			toIndex: 0,
			localProgress: 0
		});
		expect(findTrackSegment(stops, 0.2)).toMatchObject({
			fromIndex: 0,
			toIndex: 1,
			localProgress: 0.5
		});
		expect(findTrackSegment(stops, 0.7)).toMatchObject({
			fromIndex: 1,
			toIndex: 2,
			localProgress: 0.5
		});
		expect(findTrackSegment(stops, 2)).toMatchObject({
			fromIndex: 2,
			toIndex: 2,
			localProgress: 1
		});
	});

	it('samples multi-stop tracks with per-stop curve and easing overrides', () => {
		const stops: ViewportTrackStop[] = [
			{ at: 0, target: { x: 100, y: 100, zoom: 4 } },
			{ at: 0.5, target: { x: 1900, y: 900, zoom: 4 }, curve: 'fly' },
			{ at: 1, target: { x: 1900, y: 900, zoom: 1 }, easing: easeOutCubic }
		];

		const flyMid = sampleViewportTrack(stops, 0.25, imageBounds, containerSize);
		expect(flyMid).not.toBeNull();
		expect(flyMid?.zoom).toBeLessThan(4);

		const easedMid = sampleViewportTrack(stops, 0.75, imageBounds, containerSize);
		expect(easedMid).not.toBeNull();
		// easeOutCubic(0.5) = 0.875, so zoom = 4 * (1/4)^0.875.
		expect(easedMid?.zoom).toBeCloseTo(4 * Math.pow(0.25, 0.875));
	});
});
