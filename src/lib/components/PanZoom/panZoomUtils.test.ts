import { describe, expect, it } from 'vitest';
import { stageToScreen } from '../../viewport.js';
import {
	computePinchStep,
	computeWheelZoomMultiplier,
	panByScreenDelta,
	zoomAroundPoint
} from './panZoomUtils.js';

describe('panZoomUtils', () => {
	const containerSize = { width: 800, height: 600 };

	it('pans viewport inversely to screen drag delta divided by zoom', () => {
		const next = panByScreenDelta({
			viewport: { x: 500, y: 400, zoom: 2 },
			containerSize,
			deltaX: 100,
			deltaY: -60
		});

		expect(next).toEqual({ x: 450, y: 430, zoom: 2 });
	});

	it('keeps the stage point under the cursor fixed when zooming around a focal point', () => {
		const initial = { x: 1000, y: 800, zoom: 0.5 };
		const cursor = { x: 200, y: 150 };
		const stageUnderCursor = {
			x: initial.x + (cursor.x - containerSize.width / 2) / initial.zoom,
			y: initial.y + (cursor.y - containerSize.height / 2) / initial.zoom
		};

		const zoomed = zoomAroundPoint({
			viewport: initial,
			containerSize,
			focalScreenPoint: cursor,
			nextZoom: 2
		});

		expect(zoomed.zoom).toBe(2);
		const afterScreen = stageToScreen(stageUnderCursor, zoomed, containerSize);
		expect(afterScreen.x).toBeCloseTo(cursor.x);
		expect(afterScreen.y).toBeCloseTo(cursor.y);
	});

	it('clamps zoom and pan against constraints during interaction', () => {
		const constraints = {
			minZoom: 0.5,
			maxZoom: 3,
			bounds: { x: 0, y: 0, width: 1000, height: 1000 },
			minVisibilityRatio: 1
		};

		const zoomed = zoomAroundPoint({
			viewport: { x: 500, y: 500, zoom: 1 },
			containerSize,
			focalScreenPoint: { x: 400, y: 300 },
			nextZoom: 10,
			constraints
		});
		expect(zoomed.zoom).toBe(3);

		const panned = panByScreenDelta({
			viewport: { x: 500, y: 500, zoom: 2 },
			containerSize,
			deltaX: 5000,
			deltaY: 0,
			constraints
		});
		// Visible width at zoom 2 is 400 => centre cannot go below 200.
		expect(panned.x).toBe(200);
	});

	it('handles simultaneous two-finger pinch zoom and pan around the midpoint', () => {
		const initial = { x: 500, y: 500, zoom: 1 };
		const prevA = { x: 350, y: 300 };
		const prevB = { x: 450, y: 300 };
		// Spread fingers 2x wider while shifting midpoint right by 40px
		const nextA = { x: 340, y: 300 };
		const nextB = { x: 540, y: 300 };

		const result = computePinchStep({
			viewport: initial,
			containerSize,
			prevA,
			prevB,
			nextA,
			nextB,
			zoomEnabled: true,
			panEnabled: true
		});

		expect(result.zoom).toBeCloseTo(2);
		// Stage point (500, 500) was at screen (400, 300) and should now sit at screen (440, 300).
		const movedMid = stageToScreen({ x: 500, y: 500 }, result, containerSize);
		expect(movedMid.x).toBeCloseTo(440);
		expect(movedMid.y).toBeCloseTo(300);
	});

	it('produces symmetrical zoom-in and zoom-out wheel multipliers', () => {
		const zoomIn = computeWheelZoomMultiplier({
			deltaY: -100,
			deltaMode: 0,
			ctrlKey: false,
			wheelZoomFactor: 1.2
		});
		const zoomOut = computeWheelZoomMultiplier({
			deltaY: 100,
			deltaMode: 0,
			ctrlKey: false,
			wheelZoomFactor: 1.2
		});

		expect(zoomIn).toBeCloseTo(1.2);
		expect(zoomIn * zoomOut).toBeCloseTo(1);
	});
});
