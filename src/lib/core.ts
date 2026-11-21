// Everything except the Svelte components and vanilla factories.
// Shared by the Svelte entry (`index.ts`) and the vanilla entry (`vanilla/index.ts`).

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
	zoomAroundPoint
} from './components/PanZoom/panZoomUtils.js';

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
	loadDzi,
	parseDziJson,
	parseDziXml,
	resolveTilesUrlFromDziUrl,
	tileExists
} from './dzi.js';
export type { DziParseOptions } from './dzi.js';

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

export {
	buildSingleTileSpec,
	clampDpr,
	DEFAULT_MAX_DPR,
	getOptimalLevel,
	getTilesForViewport,
	makeTileKey
} from './tiling.js';
export { TileCache } from './tileCache.js';
export { DEFAULT_MAX_CONCURRENT_LOADS, TileLoader } from './tileLoader.js';
export type { TileLoaderConfig, TileLoaderOptions } from './tileLoader.js';
export {
	computeLayerOrigin,
	computeRenderPlan,
	LAYER_ORIGIN_CHUNK_SIZE,
	subtractRect,
	subtractRects
} from './retention.js';
export { EMPTY_PRECACHE_RESULT, precacheBounds, precacheViewport } from './precache.js';

export type {
	BoundsTarget,
	CachedTile,
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
	RenderLevelLayer,
	Size,
	TileErrorEvent,
	TileGrid,
	TileSpec,
	TileStatus,
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
