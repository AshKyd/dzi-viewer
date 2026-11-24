import { Gesture } from '@use-gesture/vanilla';
import type { Point } from '../../types.js';
import { computeWheelZoomMultiplier, shouldWheelZoom } from './panZoomUtils.js';

/** Current interaction settings, read on every event so prop changes apply without rebuilding. */
export interface GestureSettings {
	readonly canPan: boolean;
	readonly canZoom: boolean;
	readonly cooperativeGestures: boolean;
	readonly wheelZoomFactor: number;
}

export interface GestureControllerOptions {
	readonly getSettings: () => GestureSettings;
	/** Pans by a screen-space delta in CSS pixels (positive moves the image right/down). */
	readonly onPan: (deltaX: number, deltaY: number) => void;
	/** Zooms by `factor`, keeping `focalPoint` (element-local CSS pixels) still. */
	readonly onZoom: (factor: number, focalPoint: Point) => void;
	/** Two-finger step: the stage point under `previousMidpoint` moves to `nextMidpoint`, zooming by `scale`. */
	readonly onPinch: (previousMidpoint: Point, nextMidpoint: Point, scale: number) => void;
	readonly onDraggingChange: (isDragging: boolean) => void;
	/** A plain wheel scroll passed through to the page in cooperative mode. */
	readonly onPassThroughWheel: () => void;
}

export interface GestureController {
	/** Ends any drag or pinch in progress, e.g. when the viewport is changed from outside. */
	cancel(): void;
	destroy(): void;
}

interface PinchMemo {
	readonly scale: number;
	readonly midpoint: Point;
}

/**
 * Drag, pinch and wheel handling for `PanZoom`, built on `@use-gesture/vanilla`.
 * Gestures only report screen-space movement; the caller turns them into viewports.
 */
export function createGestureController(
	element: HTMLElement,
	options: GestureControllerOptions
): GestureController {
	const { getSettings, onPan, onZoom, onPinch, onDraggingChange, onPassThroughWheel } = options;
	const cancels = new Set<() => void>();

	const toLocal = ([clientX, clientY]: readonly number[]): Point => {
		const rect = element.getBoundingClientRect();
		return { x: (clientX ?? 0) - rect.left, y: (clientY ?? 0) - rect.top };
	};

	const gesture = new Gesture(
		element,
		{
			onDrag: ({ delta: [deltaX, deltaY], active, pinching, touches, event, cancel }) => {
				cancels.add(cancel);
				const { canPan, cooperativeGestures } = getSettings();
				// In cooperative mode one finger scrolls the page, so only two-finger pinches move the image.
				const isSingleTouch =
					'pointerType' in event && event.pointerType === 'touch' && touches === 1;
				const isPanning = active && canPan && !pinching && !(cooperativeGestures && isSingleTouch);
				onDraggingChange(isPanning);
				if (isPanning && (deltaX !== 0 || deltaY !== 0)) {
					onPan(deltaX, deltaY);
				}
			},
			onPinch: ({ offset: [scale], origin, first, memo, cancel }) => {
				cancels.add(cancel);
				const midpoint = toLocal(origin);
				const previous = memo as PinchMemo | undefined;
				if (!first && previous) {
					const { canZoom } = getSettings();
					onPinch(previous.midpoint, midpoint, canZoom ? scale / previous.scale : 1);
				}
				return { scale, midpoint } satisfies PinchMemo;
			},
			onWheel: ({ event }) => {
				const { canZoom, cooperativeGestures, wheelZoomFactor } = getSettings();
				if (!canZoom) {
					return;
				}
				const { ctrlKey, metaKey, deltaY, deltaMode, clientX, clientY } = event;
				if (!shouldWheelZoom({ cooperativeGestures, ctrlKey, metaKey })) {
					// Leave the event alone so the page scrolls.
					onPassThroughWheel();
					return;
				}
				event.preventDefault();
				const factor = computeWheelZoomMultiplier({ deltaY, deltaMode, ctrlKey, wheelZoomFactor });
				if (factor !== 1) {
					onZoom(factor, toLocal([clientX, clientY]));
				}
			}
		},
		{
			// Non-passive so wheel zoom can stop the page scrolling.
			eventOptions: { passive: false },
			// Arrow keys are handled by `PanZoom` itself.
			drag: { pointer: { keys: false } },
			// Trackpad pinch arrives as Ctrl+wheel; `onWheel` handles it with the same zoom speed as before.
			pinch: { pinchOnWheel: false, scaleBounds: { min: 0, max: Infinity }, rubberband: false }
		}
	);

	return {
		cancel() {
			cancels.forEach((cancel) => cancel());
			cancels.clear();
			onDraggingChange(false);
		},
		destroy() {
			cancels.clear();
			gesture.destroy();
		}
	};
}
