import type { Viewport } from '../../types.js';
import type { OpenSeahorseProps } from '../OpenSeahorse/openSeahorseTypes.js';

export interface PanZoomProps extends OpenSeahorseProps {
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
	/** Invoked whenever user pan/zoom interaction updates the viewport. */
	onInteract?: (viewport: Viewport) => void;
}
