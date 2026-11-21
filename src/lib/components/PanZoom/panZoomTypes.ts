import type { Viewport } from '../../types.js';
import type { DziViewerProps } from '../DziViewer/dziViewerTypes.js';

export interface CooperativeGestureMessages {
	/** Shown on a plain wheel scroll on Windows and Linux. */
	wheel: string;
	/** Shown on a plain wheel scroll on macOS and iOS. */
	wheelMac: string;
	/** Shown on a one-finger touch drag. */
	touch: string;
}

export interface PanZoomProps extends DziViewerProps {
	/** Disables all pointer, wheel, touch, and keyboard pan/zoom interactions. */
	disabled?: boolean;
	/** Enables pointer drag and touch panning. */
	panEnabled?: boolean;
	/** Enables wheel, pinch, and double-click zooming. */
	zoomEnabled?: boolean;
	/** Zoom multiplier applied per standard mouse wheel notch. */
	wheelZoomFactor?: number;
	/** Zoom multiplier applied on double-click (`0` or `1` disables double-click zoom). */
	doubleClickZoomFactor?: number;
	/** Enables arrow-key panning and `+`/`-` zooming when the viewer is focused. */
	keyboardEnabled?: boolean;
	/** CSS pixels panned per arrow key press. */
	keyboardPanStep?: number;
	/** Zoom multiplier applied per `+`/`-` key press. */
	keyboardZoomFactor?: number;
	/**
	 * Lets the page scroll past the viewer, like MapLibre's `cooperativeGestures`. The mouse wheel only zooms
	 * with Ctrl (or ⌘ on a Mac) held, and touch needs two fingers to pan or zoom. A short hint appears when a
	 * plain scroll or one-finger drag is passed through to the page. Trackpad pinch and mouse drag still work.
	 */
	cooperativeGestures?: boolean;
	/** Overrides the hint text shown by `cooperativeGestures`. */
	cooperativeGestureMessages?: Partial<CooperativeGestureMessages>;
	/**
	 * Debounce delay in ms before resuming viewport tile downloads after user pan/zoom gestures.
	 * Defaults to `0` (load immediately).
	 */
	loadDebounceMs?: number;
	/** Invoked whenever user pan/zoom interaction updates the viewport. */
	onInteract?: (viewport: Viewport) => void;
}
