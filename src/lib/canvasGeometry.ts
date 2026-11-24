import type { Rect, Size, Viewport } from './types.js';
import { stageToScreen } from './viewport.js';

/** Safari hard-caps individual 2D canvas areas at 16,777,216 pixels (4096 × 4096). */
export const SAFARI_MAX_CANVAS_PIXELS = 16_777_216;

export interface BackingCanvasSize {
	readonly width: number;
	readonly height: number;
	/** Effective backing-pixel scale relative to CSS pixels (after area clamping). */
	readonly scale: number;
}

/**
 * Computes physical canvas dimensions for `containerSize` at `dpr`, clamping total pixel area
 * to `maxPixels` so giant containers never exceed Safari's 16.7M pixel canvas limit.
 */
export function computeBackingSize(
	containerSize: Size,
	dpr: number,
	maxPixels = SAFARI_MAX_CANVAS_PIXELS
): BackingCanvasSize {
	if (containerSize.width <= 0 || containerSize.height <= 0) {
		return { width: 0, height: 0, scale: 1 };
	}

	const desiredScale = Math.max(0.1, Number.isFinite(dpr) ? dpr : 1);
	const area = containerSize.width * desiredScale * (containerSize.height * desiredScale);
	const clampFactor = area > maxPixels ? Math.sqrt(maxPixels / area) : 1;
	const scale = desiredScale * clampFactor;

	return {
		width: Math.max(1, Math.round(containerSize.width * scale)),
		height: Math.max(1, Math.round(containerSize.height * scale)),
		scale
	};
}

export interface TileDrawRectParams {
	/** Tile position and size in level pixels, including DZI overlap. */
	readonly tile: { readonly pixelRect: Rect };
	/** Pixel size of the tile's pyramid level. */
	readonly layer: { readonly levelSize: Size };
	readonly imageBounds: Rect;
	readonly viewport: Viewport;
	readonly containerSize: Size;
	readonly backingScale: number;
	/** Round edges outward to whole pixels; used when tiles have no overlap to hide seams. */
	readonly snapEdges: boolean;
}

/**
 * Computes a tile's destination rectangle in canvas backing pixels.
 * Uses `tile.pixelRect` (which includes DZI overlap) so bitmaps map 1:1 without distortion.
 */
export function computeTileDrawRect({
	tile,
	layer,
	imageBounds,
	viewport,
	containerSize,
	backingScale,
	snapEdges
}: TileDrawRectParams): Rect {
	const screenOrigin = stageToScreen(
		{ x: imageBounds.x, y: imageBounds.y },
		viewport,
		containerSize
	);
	const scaleX = (imageBounds.width * viewport.zoom) / layer.levelSize.width;
	const scaleY = (imageBounds.height * viewport.zoom) / layer.levelSize.height;

	const dx = (screenOrigin.x + tile.pixelRect.x * scaleX) * backingScale;
	const dy = (screenOrigin.y + tile.pixelRect.y * scaleY) * backingScale;
	const dw = tile.pixelRect.width * scaleX * backingScale;
	const dh = tile.pixelRect.height * scaleY * backingScale;

	if (!snapEdges) {
		return { x: dx, y: dy, width: dw, height: dh };
	}

	const x0 = Math.floor(dx);
	const y0 = Math.floor(dy);
	const x1 = Math.ceil(dx + dw);
	const y1 = Math.ceil(dy + dh);
	return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}
