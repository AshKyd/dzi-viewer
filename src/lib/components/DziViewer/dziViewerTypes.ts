import type {
	DziDescriptor,
	DziSourceInput,
	Point,
	PrecacheOptions,
	PrecacheResult,
	Rect,
	Size,
	TileErrorEvent,
	TileUrlBuilder,
	Viewport,
	ViewportConstraints,
	ViewportFitOptions
} from '../../types.js';

// Component types live in plain `.ts` so type-aware tooling (ESLint, plain `tsc`) can read them.
// Those tools can't parse `.svelte` files and would see every `.svelte` export as an error type.

export interface DziViewerProps {
	/** DZI descriptor URL (`.dzi` XML/JSON), inline DZI JSON object, or pre-parsed `DziDescriptor`. */
	source: DziSourceInput;
	/** Viewport centre X in virtual stage coordinates. */
	x?: number;
	/** Viewport centre Y in virtual stage coordinates. */
	y?: number;
	/** Scale in CSS pixels per virtual stage unit. */
	zoom?: number;
	/** Explicit virtual stage dimensions; defaults to the loaded DZI's natural pixel dimensions. */
	stageSize?: Size;
	/** Explicit placement rectangle of the DZI inside the virtual stage. */
	imageBounds?: Rect;
	/** Measured viewer container dimensions in CSS pixels (updated via `ResizeObserver`). */
	containerSize?: Size;
	/** Resolved DZI descriptor once loaded. */
	dzi?: DziDescriptor | null;
	/** True once all optimal tiles for the current viewport are decoded. */
	isOptimalLoaded?: boolean;
	/** Device pixel ratio override; defaults to `window.devicePixelRatio` capped by `maxDpr`. */
	dpr?: number;
	/** Maximum device pixel ratio used for tile level selection (defaults to `1.5`). */
	maxDpr?: number;
	/** Multiplier applied to effective DPR when selecting the optimal pyramid level. */
	quality?: number;
	/** Optional min/max zoom and stage bounds clamping constraints. */
	constraints?: ViewportConstraints;
	/** Maximum number of concurrent tile fetches (defaults to `16`, suited to HTTP/2). */
	maxConcurrentLoads?: number;
	/** Maximum number of tiles retained in the LRU cache. */
	maxCachedTiles?: number;
	/** Retry attempts per failed tile request. */
	maxRetries?: number;
	/** Delay in ms before a visible tile that failed is tried again (doubles per failure, capped at 60s). */
	failedTileRetryDelay?: number;
	/** Eagerly load the single-tile base level on initial load to avoid a blank canvas while optimal tiles decode. */
	preloadBaseLevel?: boolean;
	/** Fade-in and crossfade duration for loaded tiles in milliseconds (`0` disables fading). */
	tileFadeDuration?: number;
	/** Optional CORS attribute applied to tile images. */
	crossOrigin?: '' | 'anonymous' | 'use-credentials';
	/** Optional custom tile URL builder overriding the default DZI `{level}/{col}_{row}.{format}` pattern. */
	getTileUrl?: TileUrlBuilder;
	/** Accessible label describing the viewed image. */
	alt?: string;
	/** Optional CSS class applied to the root viewport element. */
	class?: string;
	/** Invoked when the DZI descriptor finishes loading. */
	onLoad?: (dzi: DziDescriptor) => void;
	/** Invoked when loading or parsing the DZI descriptor fails. */
	onError?: (error: unknown) => void;
	/** Invoked when a tile fails to load after exhausting retries. */
	onTileError?: (event: TileErrorEvent) => void;
}

/** Methods exported by `DziViewer` and `PanZoom` instances (via `bind:this`). */
export interface DziViewerMethods {
	/** Viewport that fits `bounds` inside the container (defaults to the image bounds). */
	getFitViewport(bounds?: Rect, options?: ViewportFitOptions): Viewport | null;
	/** Viewport that fills the container with `bounds` (defaults to the image bounds). */
	getFillViewport(bounds?: Rect, options?: ViewportFitOptions): Viewport | null;
	/** Loads the optimal tiles for `targetViewport` into the cache ahead of time. */
	precacheViewport(targetViewport: Viewport, options?: PrecacheOptions): Promise<PrecacheResult>;
	/** Loads the optimal tiles for a fit or fill view of `bounds` into the cache ahead of time. */
	precacheBounds(
		bounds: Rect | undefined,
		mode: 'fit' | 'fill',
		options?: PrecacheOptions & ViewportFitOptions
	): Promise<PrecacheResult>;
	stageToScreen(point: Point): Point;
	screenToStage(point: Point): Point;
	/**
	 * Stops starting new tile downloads for the viewport, e.g. while animating or until a custom debounce
	 * settles. The visible tile list keeps updating, so `resumeLoading()` only fetches what the final
	 * viewport needs. Precache requests and loads already in flight still complete.
	 */
	pauseLoading(): void;
	/** Starts downloading viewport tiles again after `pauseLoading()`. */
	resumeLoading(): void;
	isLoadingPaused(): boolean;
}
