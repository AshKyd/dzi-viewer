// Public API shared by the Svelte entry (`index.ts`) and the vanilla entry (`vanilla/index.ts`):
// the viewer types, camera, viewport maths, and DZI helpers for building your own renderer.
// Tile loading, caching and painting classes are internal and not exported.

export type {
	DziViewerMethods,
	DziViewerProps,
	DziViewerSnippetContext,
	ViewerLifecycleEvent,
	ViewerLifecycleListener
} from './components/DziViewer/dziViewerTypes.js';
export type {
	CooperativeGestureMessages,
	PanZoomProps
} from './components/PanZoom/panZoomTypes.js';
export {
	computePinchStep,
	computeWheelZoomMultiplier,
	DEFAULT_COOPERATIVE_GESTURE_MESSAGES,
	panByScreenDelta,
	pinchAroundMidpoint,
	zoomAroundPoint
} from './components/PanZoom/panZoomUtils.js';

export { loadDzi, parseDziJson, parseDziXml, resolveTilesUrlFromDziUrl } from './dziParse.js';
export type { DziParseOptions } from './dziParse.js';
export {
	getClosestSingleTileLevel,
	getLevelGrid,
	getLevelRange,
	getLevelScale,
	getLevelSize,
	getMaxLevel,
	getTilePixelRect,
	getTileStageRect,
	getTileUrl,
	tileExists
} from './pyramid.js';

export {
	clampViewport,
	getFillViewport,
	getFitViewport,
	getViewportBounds,
	normalisePadding,
	rectIntersection,
	rectIntersects,
	resolveStageAndImageBounds,
	screenToStage,
	stageRectToScreen,
	stageRectToStyle,
	stageToScreen,
	viewportsEqual
} from './viewport.js';

export {
	easeInOutCubic,
	easeOutCubic,
	findTrackSegment,
	interpolateTarget,
	interpolateViewport,
	isViewportTargetExplicit,
	resolveViewportTarget,
	sampleViewportTrack
} from './transition.js';
export type { TrackSegmentMatch } from './transition.js';

export { createCamera } from './camera.js';
export type {
	CameraOptions,
	DziCamera,
	ScrubOptions,
	ScrubPrecacheMode,
	TransitionOptions,
	TransitionResult
} from './camera.js';

export { getOptimalLevel, getTilesForViewport } from './tiling.js';
export type { ViewportTilesParams, ViewportTilesResult } from './tiling.js';

export type {
	BoundsTarget,
	DisplayRect,
	DziDescriptor,
	DziJsonDisplayRect,
	DziJsonInput,
	DziLoadOptions,
	DziSourceInput,
	EasingFunction,
	InterpolateViewportOptions,
	Padding,
	PaddingEdges,
	Point,
	PrecacheOptions,
	PrecacheResult,
	Rect,
	Size,
	TileErrorEvent,
	TileGrid,
	TileSpec,
	TileUrlBuilder,
	TransitionCurve,
	Viewport,
	ViewportConstraints,
	ViewportFitOptions,
	ViewportTarget,
	ViewportTargetContext,
	ViewportTargetResolver,
	ViewportTolerance,
	ViewportTrackStop
} from './types.js';
