import { describe, expect, it } from 'vitest';
import {
	clampViewport,
	getFillViewport,
	getFitViewport,
	getViewportBounds,
	resolveStageAndImageBounds,
	screenToStage,
	stageToScreen
} from './viewport.js';

describe('viewport utilities', () => {
	const imageBounds = { x: 0, y: 0, width: 2000, height: 1000 };
	const container = { width: 1000, height: 1000 };

	it('fits bounds inside container using contain scaling', () => {
		const vp = getFitViewport(imageBounds, container);
		expect(vp).toEqual({ x: 1000, y: 500, zoom: 0.5 });
	});

	it('fills container with bounds using cover scaling', () => {
		const vp = getFillViewport(imageBounds, container);
		expect(vp).toEqual({ x: 1000, y: 500, zoom: 1 });
	});

	it('respects asymmetric padding when fitting bounds', () => {
		const vp = getFitViewport(
			{ x: 0, y: 0, width: 800, height: 400 },
			{ width: 1000, height: 600 },
			{ padding: { left: 200, right: 0, top: 100, bottom: 100 } }
		);
		expect(vp.zoom).toBeCloseTo(1);
		// Bounds centre (400, 200) should map to padded centre (600, 300) on screen.
		const screenCentre = stageToScreen({ x: 400, y: 200 }, vp, { width: 1000, height: 600 });
		expect(screenCentre.x).toBeCloseTo(600);
		expect(screenCentre.y).toBeCloseTo(300);
	});

	it('round-trips stage and screen coordinates', () => {
		const vp = { x: 420, y: 310, zoom: 1.75 };
		const stagePoint = { x: 640, y: 125 };
		const screenPoint = stageToScreen(stagePoint, vp, { width: 800, height: 600 });
		const roundTripped = screenToStage(screenPoint, vp, { width: 800, height: 600 });

		expect(roundTripped.x).toBeCloseTo(stagePoint.x);
		expect(roundTripped.y).toBeCloseTo(stagePoint.y);
	});

	it('computes visible viewport bounds accurately', () => {
		const bounds = getViewportBounds({ x: 500, y: 400, zoom: 2 }, { width: 400, height: 200 });
		expect(bounds).toEqual({ x: 400, y: 350, width: 200, height: 100 });
	});

	it('clamps zoom and pan within bounds constraints', () => {
		const clamped = clampViewport(
			{ x: 5000, y: -500, zoom: 10 },
			{ minZoom: 0.5, maxZoom: 2, bounds: imageBounds, minVisibilityRatio: 1 },
			{ width: 400, height: 400 }
		);
		expect(clamped.zoom).toBe(2);
		// Visible span at zoom 2 is 200x200; centre must stay inside [100..1900] x [100..900].
		expect(clamped.x).toBe(1900);
		expect(clamped.y).toBe(100);
	});

	it('resolves stage and image bounds preserving DZI aspect ratio when stageSize differs', () => {
		const resolved = resolveStageAndImageBounds(
			{ width: 4000, height: 2000 },
			{ width: 1000, height: 1000 }
		);
		expect(resolved.stageSize).toEqual({ width: 1000, height: 1000 });
		expect(resolved.imageBounds).toEqual({ x: 0, y: 250, width: 1000, height: 500 });
	});
});
