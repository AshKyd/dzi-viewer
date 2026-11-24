export interface Point {
	readonly x: number;
	readonly y: number;
}

export interface Size {
	readonly width: number;
	readonly height: number;
}

export interface Rect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface PaddingEdges {
	readonly top?: number;
	readonly right?: number;
	readonly bottom?: number;
	readonly left?: number;
}

export type Padding = number | PaddingEdges;

/**
 * Viewport state in virtual stage coordinates.
 * `x` and `y` represent the viewport centre; `zoom` is CSS pixels per virtual stage unit.
 */
export interface Viewport {
	readonly x: number;
	readonly y: number;
	readonly zoom: number;
}

export interface ViewportFitOptions {
	readonly padding?: Padding;
}

export interface ViewportTolerance {
	/** Maximum difference in stage units for `x` and `y` (defaults to `0.01`). */
	readonly position?: number;
	/** Relative zoom tolerance scaled by `Math.max(1, a.zoom, b.zoom)` (defaults to `1e-6`). */
	readonly zoom?: number;
}

export type EasingFunction = (t: number) => number;

/**
 * Interpolation path between two viewports.
 * - `'direct'`: exponential zoom with inverse-zoom-weighted pan straight towards the target.
 * - `'fly'`: van Wijk & Nuij smooth pan-and-zoom arc via `d3-interpolate`'s `interpolateZoom`.
 */
export type TransitionCurve = 'direct' | 'fly';

export interface BoundsTarget {
	/** Stage-space rectangle to frame (defaults to the loaded image bounds). */
	readonly bounds?: Rect;
	/** Whether to contain (`'fit'`, default) or cover (`'fill'`) the container. */
	readonly mode?: 'fit' | 'fill';
	/** Optional CSS pixel padding around the framed bounds. */
	readonly padding?: Padding;
}

export interface ViewportTargetContext {
	readonly imageBounds: Rect;
	readonly containerSize: Size;
}

/** Dynamic resolver for custom coordinate systems (e.g. legacy normalised crop/zoom). */
export type ViewportTargetResolver = (context: ViewportTargetContext) => Viewport;

export type ViewportTarget = Viewport | BoundsTarget | 'fit' | 'fill' | ViewportTargetResolver;

export interface InterpolateViewportOptions {
	readonly curve?: TransitionCurve;
	readonly easing?: EasingFunction;
	/** Container dimensions used to compute the visible span for `'fly'` curves. */
	readonly containerSize?: Size;
	/** Curvature factor passed to `d3-interpolate`'s `interpolateZoom.rho(rho)` for `'fly'` curves. */
	readonly rho?: number;
}

export interface ViewportTrackStop {
	/** Track position for this stop (stops are expected in ascending `at` order). */
	readonly at: number;
	readonly target: ViewportTarget;
	/** Easing applied to the segment arriving at this stop. */
	readonly easing?: EasingFunction;
	/** Curve applied to the segment arriving at this stop. */
	readonly curve?: TransitionCurve;
}

export interface ViewportConstraints {
	readonly minZoom?: number;
	readonly maxZoom?: number;
	/** Stage-space rectangle used to constrain visible viewport bounds. */
	readonly bounds?: Rect;
	/**
	 * Fraction (0..1) of the constrained bounds (or viewport when zoomed in) that must stay visible.
	 * Defaults to 1.
	 */
	readonly minVisibilityRatio?: number;
}

export interface DisplayRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly minLevel: number;
	readonly maxLevel: number;
}

export type TileUrlBuilder = (level: number, col: number, row: number) => string;

export interface DziDescriptor {
	readonly width: number;
	readonly height: number;
	readonly tileSize: number;
	readonly overlap: number;
	readonly format: string;
	readonly tilesUrl: string;
	readonly queryParams?: string;
	readonly minLevel: number;
	readonly maxLevel: number;
	readonly displayRects?: readonly DisplayRect[];
	readonly getTileUrl?: TileUrlBuilder;
}

export interface DziJsonDisplayRect {
	readonly Rect: {
		readonly X: number | string;
		readonly Y: number | string;
		readonly Width: number | string;
		readonly Height: number | string;
	};
	readonly MinLevel: number | string;
	readonly MaxLevel: number | string;
}

export interface DziJsonInput {
	readonly Image: {
		readonly xmlns?: string;
		readonly Url?: string;
		readonly Format: string;
		readonly Overlap: number | string;
		readonly TileSize: number | string;
		readonly Size: {
			readonly Width: number | string;
			readonly Height: number | string;
		};
		readonly DisplayRects?: readonly DziJsonDisplayRect[];
	};
}

export type DziSourceInput = string | DziDescriptor | DziJsonInput;

export interface DziLoadOptions {
	readonly signal?: AbortSignal;
	readonly fetch?: typeof globalThis.fetch;
	readonly getTileUrl?: TileUrlBuilder;
	readonly tilesUrl?: string;
}

export interface TileGrid {
	readonly cols: number;
	readonly rows: number;
}

export interface TileSpec {
	readonly key: string;
	readonly level: number;
	readonly col: number;
	readonly row: number;
	readonly url: string;
	/** Position and size in level-native pixels, including DZI overlap. */
	readonly pixelRect: Rect;
	/** Non-overlapping logical footprint in virtual stage coordinates for culling and coverage checks. */
	readonly stageRect: Rect;
	/** Squared distance from viewport centre in stage coordinates, used to prioritise central tiles. */
	readonly distanceSq: number;
}

export type TileStatus = 'loading' | 'ready' | 'error';

export interface CachedTile {
	readonly key: string;
	readonly level: number;
	readonly col: number;
	readonly row: number;
	readonly url: string;
	readonly pixelRect: Rect;
	stageRect: Rect;
	status: TileStatus;
	bitmap?: ImageBitmap;
	lastUsed: number;
	error?: unknown;
	/** `Date.now()` of the most recent failure, used to time retries. */
	failedAt?: number;
}

export interface TileErrorEvent {
	readonly key: string;
	readonly level: number;
	readonly col: number;
	readonly row: number;
	readonly url: string;
	readonly error: unknown;
}

export interface PrecacheOptions {
	readonly signal?: AbortSignal;
	readonly dpr?: number;
	readonly maxDpr?: number;
	readonly quality?: number;
}

export interface PrecacheResult {
	readonly total: number;
	readonly loaded: number;
	readonly failed: number;
	readonly cancelled: boolean;
}

export interface RenderLevelLayer {
	readonly level: number;
	readonly isOptimal: boolean;
	readonly levelSize: Size;
	readonly tiles: readonly CachedTile[];
}
