import type {
	DziDescriptor,
	PrecacheOptions,
	PrecacheResult,
	Rect,
	Size,
	TileErrorEvent,
	Viewport,
	ViewportFitOptions
} from './types.js';

export type CrossOrigin = '' | 'anonymous' | 'use-credentials';

export interface TileEngineConfig {
	readonly maxDpr?: number;
	readonly quality?: number;
	readonly maxConcurrentLoads?: number;
	readonly maxCachedTiles?: number;
	readonly maxRetries?: number;
	readonly failedTileRetryDelay?: number;
	readonly preloadBaseLevel?: boolean;
	readonly crossOrigin?: CrossOrigin;
}

/** Every `TileEngineConfig` field, so configs can be picked out of wider option objects. */
export const ENGINE_CONFIG_KEYS = [
	'maxDpr',
	'quality',
	'maxConcurrentLoads',
	'maxCachedTiles',
	'maxRetries',
	'failedTileRetryDelay',
	'preloadBaseLevel',
	'crossOrigin'
] as const satisfies readonly (keyof TileEngineConfig)[];

/**
 * Copies only the engine fields that are set, as a plain object safe to `postMessage`.
 * `crossOrigin: undefined` is kept when the key is present, because it means "no CORS credentials".
 */
export function pickEngineConfig(config: TileEngineConfig): TileEngineConfig {
	return Object.fromEntries(
		ENGINE_CONFIG_KEYS.filter(
			(key) => key in config && (config[key] !== undefined || key === 'crossOrigin')
		).map((key) => [key, config[key]])
	);
}

/** Compact tile geometry needed by the main-thread WebGL painter (no URLs, stageRects, or LRU metadata). */
export interface SurfaceTile {
	readonly key: string;
	readonly pixelRect: Rect;
}

/** Compact layer list emitted by the engine whenever the visible tile plan changes. */
export interface SurfaceLayer {
	readonly level: number;
	readonly isOptimal: boolean;
	readonly levelSize: Size;
	readonly tiles: readonly SurfaceTile[];
}

export interface AddedTilePayload {
	readonly key: string;
	readonly bitmap: ImageBitmap;
}

export interface BaseTileSnapshot {
	readonly key: string;
	readonly levelSize: Size;
	readonly pixelRect: Rect;
}

/**
 * Coalesced state diff sent from `TileEngine` (Worker or in-process) to the main-thread painter.
 * Only changed fields are included to minimise `postMessage` serialisation cost.
 */
export interface TileEngineDelta {
	readonly clearAll?: boolean;
	readonly addedTiles?: readonly AddedTilePayload[];
	readonly evictKeys?: readonly string[];
	readonly layers?: readonly SurfaceLayer[];
	/** Single-tile base preview covering the whole image; pinned underneath on Worker paint so fast pans never expose white edges. */
	readonly baseTile?: BaseTileSnapshot | null;
	/** Optimal tile keys ordered centre-out so main-thread GPU uploads prioritise the viewport centre. */
	readonly optimalUploadOrder?: readonly string[];
	readonly isOptimalLoaded?: boolean;
	readonly tileErrors?: readonly TileErrorEvent[];
}

/** `DziDescriptor` without non-cloneable function fields (`getTileUrl`). */
export type SerializableDziDescriptor = Omit<DziDescriptor, 'getTileUrl'>;

export type SerializablePrecacheOptions = Omit<PrecacheOptions, 'signal'>;

export type SerializablePrecacheBoundsOptions = Omit<
	PrecacheOptions & ViewportFitOptions,
	'signal'
>;

/** Batched per-frame state update sent from main thread → Worker in a single `postMessage`. */
export interface EngineFrameSync {
	readonly config?: TileEngineConfig;
	readonly source?: {
		readonly dzi: SerializableDziDescriptor | null;
		readonly imageBounds: Rect | null;
		readonly sourceId: string;
	};
	readonly imageBounds?: Rect | null;
	readonly container?: { readonly size: Size; readonly deviceDpr: number };
	readonly viewport?: Viewport;
	readonly opaqueKeys?: readonly string[];
	readonly clearOpaque?: boolean;
}

export type EngineInboundMessage =
	| { readonly type: 'sync'; readonly frame: EngineFrameSync }
	| {
			readonly type: 'precacheViewport';
			readonly id: number;
			readonly viewport: Viewport;
			readonly options?: SerializablePrecacheOptions;
	  }
	| {
			readonly type: 'precacheBounds';
			readonly id: number;
			readonly bounds?: Rect;
			readonly mode: 'fit' | 'fill';
			readonly options?: SerializablePrecacheBoundsOptions;
	  }
	| { readonly type: 'abortPrecache'; readonly id: number }
	| { readonly type: 'pauseLoading'; readonly reason?: string }
	| { readonly type: 'resumeLoading'; readonly reason?: string }
	| { readonly type: 'holdResolution' }
	| { readonly type: 'releaseResolution' }
	| { readonly type: 'destroy' };

export type EngineOutboundMessage =
	| { readonly type: 'delta'; readonly delta: TileEngineDelta }
	| { readonly type: 'precacheResult'; readonly id: number; readonly result: PrecacheResult };
