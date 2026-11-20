import type { Point, Size, Viewport, ViewportConstraints } from '../../types.js';
import type { CooperativeGestureMessages } from './panZoomTypes.js';
import { clampViewport, screenToStage } from '../../viewport.js';

const MIN_SAFE_ZOOM = 1e-6;
const MAX_WHEEL_DELTA_PX = 300;

function clampZoomValue(zoom: number, constraints?: ViewportConstraints): number {
	const minZoom = Math.max(MIN_SAFE_ZOOM, constraints?.minZoom ?? MIN_SAFE_ZOOM);
	const maxZoom = constraints?.maxZoom ?? Number.POSITIVE_INFINITY;
	return Math.min(maxZoom, Math.max(minZoom, zoom));
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

	const clampedZoom = clampZoomValue(nextZoom, constraints);
	const focalStage = screenToStage(focalScreenPoint, viewport, containerSize);

	const next: Viewport = {
		x: focalStage.x - (focalScreenPoint.x - containerSize.width / 2) / clampedZoom,
		y: focalStage.y - (focalScreenPoint.y - containerSize.height / 2) / clampedZoom,
		zoom: clampedZoom
	};

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

/**
 * Computes a combined two-finger pinch zoom and pan update around the live pinch midpoint.
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
	if (viewport.zoom <= 0 || containerSize.width <= 0 || containerSize.height <= 0) {
		return viewport;
	}

	const prevMid: Point = { x: (prevA.x + prevB.x) / 2, y: (prevA.y + prevB.y) / 2 };
	const nextMid: Point = { x: (nextA.x + nextB.x) / 2, y: (nextA.y + nextB.y) / 2 };
	const prevDist = Math.hypot(prevB.x - prevA.x, prevB.y - prevA.y);
	const nextDist = Math.hypot(nextB.x - nextA.x, nextB.y - nextA.y);

	const scale = zoomEnabled && prevDist > 1 && nextDist > 1 ? nextDist / prevDist : 1;
	const targetZoom = clampZoomValue(viewport.zoom * scale, constraints);
	const anchorStage = screenToStage(prevMid, viewport, containerSize);
	const targetMid = panEnabled ? nextMid : prevMid;

	const next: Viewport = {
		x: anchorStage.x - (targetMid.x - containerSize.width / 2) / targetZoom,
		y: anchorStage.y - (targetMid.y - containerSize.height / 2) / targetZoom,
		zoom: targetZoom
	};

	return clampViewport(next, constraints, containerSize);
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
