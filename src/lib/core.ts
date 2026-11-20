// Everything except the Svelte components and vanilla factories.
// Shared by the Svelte entry (`index.ts`) and the vanilla entry (`vanilla/index.ts`).

export type {
	DziViewerMethods,
	DziViewerProps
} from './components/DziViewer/dziViewerTypes.js';
export type { PanZoomProps } from './components/PanZoom/panZoomTypes.js';
export {
	computePinchStep,
	computeWheelZoomMultiplier,
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
	stageToScreen
} from './viewport.js';

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
	CachedTile,
	DisplayRect,
	DziDescriptor,
	DziJsonDisplayRect,
	DziJsonInput,
	DziLoadOptions,
	DziSourceInput,
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
	Viewport,
	ViewportConstraints,
	ViewportFitOptions
} from './types.js';
