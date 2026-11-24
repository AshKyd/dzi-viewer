import type { Point, Size, Viewport, ViewportConstraints } from '../../types.js';
import type { CooperativeGestureMessages } from './panZoomTypes.js';
import { clampViewport, clampZoom, screenToStage } from '../../viewport.js';

/** Gestures never reach zero zoom, which would make stage maths divide by zero. */
const MIN_SAFE_ZOOM = 1e-6;
const MAX_WHEEL_DELTA_PX = 300;

/** Viewport at `zoom` that places `stagePoint` under `screenPoint`. */
function anchorStagePointAtScreen(
	stagePoint: Point,
	screenPoint: Point,
	zoom: number,
	containerSize: Size
): Viewport {
	return {
		x: stagePoint.x - (screenPoint.x - containerSize.width / 2) / zoom,
		y: stagePoint.y - (screenPoint.y - containerSize.height / 2) / zoom,
		zoom
	};
}

export interface PanByDeltaParams {
	readonly viewport: Viewport;
	readonly containerSize: Size;
	readonly deltaX: number;
	readonly deltaY: number;
	readonly constraints?: ViewportConstraints;
}

/**
 * Translates the viewport by a screen-space pointer drag delta (positive delta drags the image right/down).
 */
export function panByScreenDelta({
	viewport,
	containerSize,
	deltaX,
	deltaY,
	constraints
}: PanByDeltaParams): Viewport {
	if (viewport.zoom <= 0) {
		return viewport;
	}

	const next: Viewport = {
		x: viewport.x - deltaX / viewport.zoom,
		y: viewport.y - deltaY / viewport.zoom,
		zoom: viewport.zoom
	};

	return clampViewport(next, constraints, containerSize);
}

export interface ZoomAroundPointParams {
	readonly viewport: Viewport;
	readonly containerSize: Size;
	readonly focalScreenPoint: Point;
	readonly nextZoom: number;
	readonly constraints?: ViewportConstraints;
}

/**
 * Changes zoom while keeping the virtual stage coordinate under `focalScreenPoint` stationary on screen.
 */
export function zoomAroundPoint({
	viewport,
	containerSize,
	focalScreenPoint,
	nextZoom,
	constraints
}: ZoomAroundPointParams): Viewport {
	if (viewport.zoom <= 0 || containerSize.width <= 0 || containerSize.height <= 0) {
		return viewport;
	}

	const focalStage = screenToStage(focalScreenPoint, viewport, containerSize);
	const next = anchorStagePointAtScreen(
		focalStage,
		focalScreenPoint,
		clampZoom(nextZoom, constraints, MIN_SAFE_ZOOM),
		containerSize
	);
	return clampViewport(next, constraints, containerSize);
}

export interface PinchStepParams {
	readonly viewport: Viewport;
	readonly containerSize: Size;
	readonly prevA: Point;
	readonly prevB: Point;
	readonly nextA: Point;
	readonly nextB: Point;
	readonly zoomEnabled: boolean;
	readonly panEnabled: boolean;
	readonly constraints?: ViewportConstraints;
}

export interface PinchAroundMidpointParams {
	readonly viewport: Viewport;
	readonly containerSize: Size;
	/** Midpoint between the two fingers on the previous step, in container pixels. */
	readonly previousMidpoint: Point;
	readonly nextMidpoint: Point;
	/** Zoom multiplier for this step (`1` when zooming is off). */
	readonly scale: number;
	/** When false the midpoint's stage point stays put instead of following the fingers. */
	readonly panEnabled: boolean;
	readonly constraints?: ViewportConstraints;
}

/** One pinch step: zooms by `scale` while the stage point under the fingers follows their midpoint. */
export function pinchAroundMidpoint({
	viewport,
	containerSize,
	previousMidpoint,
	nextMidpoint,
	scale,
	panEnabled,
	constraints
}: PinchAroundMidpointParams): Viewport {
	if (viewport.zoom <= 0 || containerSize.width <= 0 || containerSize.height <= 0) {
		return viewport;
	}
	const anchorStage = screenToStage(previousMidpoint, viewport, containerSize);
	const next = anchorStagePointAtScreen(
		anchorStage,
		panEnabled ? nextMidpoint : previousMidpoint,
		clampZoom(viewport.zoom * scale, constraints, MIN_SAFE_ZOOM),
		containerSize
	);
	return clampViewport(next, constraints, containerSize);
}

/**
 * Computes a combined two-finger pinch zoom and pan update from both fingers' previous and next positions.
 */
export function computePinchStep({
	viewport,
	containerSize,
	prevA,
	prevB,
	nextA,
	nextB,
	zoomEnabled,
	panEnabled,
	constraints
}: PinchStepParams): Viewport {
	const prevDist = Math.hypot(prevB.x - prevA.x, prevB.y - prevA.y);
	const nextDist = Math.hypot(nextB.x - nextA.x, nextB.y - nextA.y);
	// Ignore tiny finger separations, where a pixel of jitter would be a huge zoom.
	const scale = zoomEnabled && prevDist > 1 && nextDist > 1 ? nextDist / prevDist : 1;
	return pinchAroundMidpoint({
		viewport,
		containerSize,
		previousMidpoint: { x: (prevA.x + prevB.x) / 2, y: (prevA.y + prevB.y) / 2 },
		nextMidpoint: { x: (nextA.x + nextB.x) / 2, y: (nextA.y + nextB.y) / 2 },
		scale,
		panEnabled,
		constraints
	});
}

export interface WheelZoomParams {
	readonly deltaY: number;
	readonly deltaMode: number;
	readonly ctrlKey: boolean;
	readonly wheelZoomFactor: number;
}

/**
 * Converts a browser `WheelEvent` delta into a smooth zoom multiplier across mouse wheels and trackpads.
 */
export function computeWheelZoomMultiplier({
	deltaY,
	deltaMode,
	ctrlKey,
	wheelZoomFactor
}: WheelZoomParams): number {
	if (deltaY === 0 || wheelZoomFactor <= 0) {
		return 1;
	}

	const rawPixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
	const clampedPixels = Math.max(-MAX_WHEEL_DELTA_PX, Math.min(MAX_WHEEL_DELTA_PX, rawPixels));
	const divisor = ctrlKey ? 40 : 100;

	return wheelZoomFactor ** (-clampedPixels / divisor);
}

// --- Cooperative gestures ---

export const DEFAULT_COOPERATIVE_GESTURE_MESSAGES: CooperativeGestureMessages = {
	wheel: 'Use Ctrl + scroll to zoom the image',
	wheelMac: 'Use ⌘ + scroll to zoom the image',
	touch: 'Use two fingers to move the image'
};

export interface CooperativeWheelParams {
	readonly cooperativeGestures: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
}

/**
 * Whether a wheel event should zoom the viewer rather than scroll the page.
 * Trackpad pinch arrives as a wheel event with `ctrlKey` set, so it still zooms in cooperative mode.
 */
export function shouldWheelZoom({
	cooperativeGestures,
	ctrlKey,
	metaKey
}: CooperativeWheelParams): boolean {
	return !cooperativeGestures || ctrlKey || metaKey;
}

/** True on macOS and iOS, where the zoom modifier is shown as ⌘ instead of Ctrl. */
export function isApplePlatform(platform: string): boolean {
	return /Mac|iPhone|iPad|iPod/i.test(platform);
}
