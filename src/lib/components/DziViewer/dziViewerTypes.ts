import type { Snippet } from 'svelte';
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
	ViewportFitOptions,
	ViewportTarget
} from '../../types.js';

// Component types live in plain `.ts` so type-aware tooling (ESLint, plain `tsc`) can read them.
// Those tools can't parse `.svelte` files and would see every `.svelte` export as an error type.

/** Context passed to the `DziViewer` / `PanZoom` `children` overlay snippet. */
export interface DziViewerSnippetContext {
	readonly viewport: Viewport;
	readonly containerSize: Size;
	readonly dzi: DziDescriptor | null;
	readonly imageBounds: Rect | null;
	readonly stageToScreen: (point: Point) => Point;
	readonly screenToStage: (point: Point) => Point;
	readonly stageRectToScreen: (rect: Rect) => Rect;
	readonly stageRectToStyle: (rect: Rect) => string;
}

export type ViewerLifecycleEvent =
	| { readonly type: 'load'; readonly dzi: DziDescriptor }
	| { readonly type: 'resize'; readonly containerSize: Size }
	| { readonly type: 'source-change' }
	| { readonly type: 'interact'; readonly viewport: Viewport }
	| { readonly type: 'destroy' };

export type ViewerLifecycleListener = (event: ViewerLifecycleEvent) => void;

export interface DziViewerProps {
	/** DZI descriptor URL (`.dzi` XML/JSON), inline DZI JSON object, or pre-parsed `DziDescriptor`. Pass `null`/`''` to clear. */
	source?: DziSourceInput | null;
	/** Viewport applied once per `source` as soon as the DZI descriptor and container size are known. */
	initialView?: ViewportTarget;
	/** Optional overlay content rendered above tile layers inside the viewer container. */
	children?: Snippet<[DziViewerSnippetContext]>;
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
	/** Maximum device pixel ratio used for tile level selection (defaults to `1`). */
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
	/** Draw a lime-green outline around every rendered tile for debugging tile bounds and levels. */
	debug?: boolean;
	/** Optional CORS credentials mode applied to tile fetches (`'use-credentials'` sends credentials). */
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

/** Methods exported by `DziViewer` and `PanZoom` instances (via `bind:this`). They don't use `this`, so they can be passed around detached. */
export interface DziViewerMethods {
	/** Updates any subset of `x`, `y`, and `zoom` on the viewer. */
	setViewport(this: void, viewport: Partial<Viewport>): void;
	/** Returns the currently rendered (clamped) `{ x, y, zoom }` viewport. */
	getViewport(this: void): Viewport;
	/** Returns the resolved stage-space bounds of the loaded DZI image, or `null` before load. */
	getImageBounds(this: void): Rect | null;
	/** Returns the measured container dimensions in CSS pixels. */
	getContainerSize(this: void): Size;
	/** Subscribes to viewer lifecycle events (`load`, `resize`, `source-change`, `interact`, `destroy`). */
	subscribe(this: void, listener: ViewerLifecycleListener): () => void;
	/** Viewport that fits `bounds` inside the container (defaults to the image bounds). */
	getFitViewport(this: void, bounds?: Rect, options?: ViewportFitOptions): Viewport | null;
	/** Viewport that fills the container with `bounds` (defaults to the image bounds). */
	getFillViewport(this: void, bounds?: Rect, options?: ViewportFitOptions): Viewport | null;
	/** Loads the optimal tiles for `targetViewport` into the cache ahead of time. */
	precacheViewport(
		this: void,
		targetViewport: Viewport,
		options?: PrecacheOptions
	): Promise<PrecacheResult>;
	/** Loads the optimal tiles for a fit or fill view of `bounds` into the cache ahead of time. */
	precacheBounds(
		this: void,
		bounds: Rect | undefined,
		mode: 'fit' | 'fill',
		options?: PrecacheOptions & ViewportFitOptions
	): Promise<PrecacheResult>;
	stageToScreen(this: void, point: Point): Point;
	screenToStage(this: void, point: Point): Point;
	/**
	 * Stops starting new tile downloads for the viewport, e.g. while animating or until a custom debounce
	 * settles. The visible tile list keeps updating, so `resumeLoading()` only fetches what the final
	 * viewport needs. Precache requests and loads already in flight still complete.
	 * Pass an optional `reason` token to scope independent callers.
	 */
	pauseLoading(this: void, reason?: string): void;
	/** Starts downloading viewport tiles again after `pauseLoading()`. */
	resumeLoading(this: void, reason?: string): void;
	isLoadingPaused(this: void): boolean;
	/**
	 * Stops the viewer switching to a sharper pyramid level, e.g. during a zoom animation, so it doesn't
	 * mount a new set of tiles at every level it passes through. Zooming in shows the held level enlarged;
	 * zooming out still drops to coarser levels so tile counts stay low. Independent of `pauseLoading()`:
	 * downloads for the held level continue unless loading is also paused.
	 * Does nothing until a DZI has loaded and the container has a size.
	 */
	holdResolution(this: void): void;
	/** Lets the viewer pick the best level for the current zoom again after `holdResolution()`. */
	releaseResolution(this: void): void;
	isResolutionHeld(this: void): boolean;
}
