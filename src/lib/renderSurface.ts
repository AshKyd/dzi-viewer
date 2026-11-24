import {
	CanvasScaleMode,
	Color,
	ExpandMode,
	Rapid,
	Texture,
	TextureFilterMode,
	TextureWrapMode,
	Vec2
} from 'rapid-render';
import type { AnyCanvas, AnyCanvas2DContext } from './canvasRenderer.js';
import type { Rect } from './types.js';

export interface RenderSurface {
	readonly kind: 'webgl' | '2d';
	resize(width: number, height: number): void;
	clear(): void;
	beginFrame(): void;
	/** Returns true if `key` is already ready to draw on the surface (no GPU upload needed). */
	hasTile(key: string): boolean;
	/** Uploads a decoded `ImageBitmap` to the surface so subsequent `drawTile()` calls are instant. */
	uploadTile(key: string, bitmap: ImageBitmap): void;
	drawTile(key: string, bitmap: ImageBitmap | undefined, rect: Rect, alpha: number): void;
	drawDebugOutline(rect: Rect, lineWidth: number): void;
	endFrame(): void;
	evictTile(key: string): void;
	clearTiles(): void;
	destroy(): void;
}

const DEBUG_LIMEGREEN = new Color(50, 205, 50, 255);

function isHtmlCanvas(canvas: AnyCanvas): canvas is HTMLCanvasElement {
	return typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement;
}

/** Clears inline styles that `Rapid`'s `viewport.resize()` writes onto `HTMLCanvasElement`s. */
function restoreHtmlCanvasStyle(canvas: AnyCanvas): void {
	if (!isHtmlCanvas(canvas)) {
		return;
	}
	canvas.style.width = '';
	canvas.style.height = '';
	canvas.style.imageRendering = '';
}

/**
 * Hardware-accelerated WebGL2 tile surface powered by `rapid-render`.
 * Uploads each tile `ImageBitmap` once as a GPU texture, batches sprites per frame, and destroys
 * GPU textures when the engine evicts the tile.
 */
class RapidWebGLSurface implements RenderSurface {
	readonly kind = 'webgl';
	readonly #canvas: AnyCanvas;
	readonly #rapid: Rapid;
	readonly #textures = new Map<string, Texture>();
	readonly #scaleVec = new Vec2(1, 1);
	readonly #tintColour = new Color(255, 255, 255, 255);
	#destroyed = false;

	constructor(canvas: AnyCanvas) {
		if (typeof WebGL2RenderingContext === 'undefined' || typeof window === 'undefined') {
			throw new Error('WebGL2RenderingContext is unavailable');
		}

		const initialWidth = Math.max(1, canvas.width || 1);
		const initialHeight = Math.max(1, canvas.height || 1);

		this.#canvas = canvas;
		this.#rapid = new Rapid({
			canvas: canvas as unknown as HTMLCanvasElement,
			width: initialWidth,
			height: initialHeight,
			physicsWidth: initialWidth,
			physicsHeight: initialHeight,
			backgroundColor: Color.Transparent,
			textureFilter: TextureFilterMode.LINEAR,
			premultipliedAlpha: true,
			window: {
				scaleMode: CanvasScaleMode.Viewport,
				expand: ExpandMode.IGNORE
			}
		});
		this.#rapid.dpr = 1;
		restoreHtmlCanvasStyle(canvas);
	}

	resize(width: number, height: number): void {
		if (this.#destroyed || width <= 0 || height <= 0) {
			return;
		}
		this.#rapid.resize(width, height);
		restoreHtmlCanvasStyle(this.#canvas);
	}

	clear(): void {
		if (this.#destroyed || this.#canvas.width <= 0 || this.#canvas.height <= 0) {
			return;
		}
		this.#rapid.clear();
		this.#rapid.flush();
	}

	beginFrame(): void {
		if (this.#destroyed) {
			return;
		}
		this.#rapid.clear();
	}

	hasTile(key: string): boolean {
		return this.#textures.has(key);
	}

	uploadTile(key: string, bitmap: ImageBitmap): void {
		if (this.#destroyed || this.#textures.has(key)) {
			return;
		}
		const texture = this.#rapid.texture.create(bitmap, {
			key,
			textureFilter: TextureFilterMode.LINEAR,
			wrap: TextureWrapMode.CLAMP
		});
		this.#textures.set(key, texture);
	}

	drawTile(key: string, bitmap: ImageBitmap | undefined, rect: Rect, alpha: number): void {
		if (this.#destroyed) {
			return;
		}
		if (!this.#textures.has(key) && bitmap) {
			this.uploadTile(key, bitmap);
		}
		const texture = this.#textures.get(key);
		if (!texture || texture.rawWidth <= 0 || texture.rawHeight <= 0) {
			return;
		}

		this.#scaleVec.x = rect.width / texture.rawWidth;
		this.#scaleVec.y = rect.height / texture.rawHeight;

		if (alpha < 1) {
			this.#tintColour.setRGBA(255, 255, 255, Math.round(alpha * 255));
			this.#rapid.drawSprite({
				texture,
				x: rect.x,
				y: rect.y,
				scale: this.#scaleVec,
				color: this.#tintColour
			});
			return;
		}

		this.#rapid.drawSprite({
			texture,
			x: rect.x,
			y: rect.y,
			scale: this.#scaleVec
		});
	}

	drawDebugOutline(rect: Rect, lineWidth: number): void {
		if (this.#destroyed) {
			return;
		}
		const inset = lineWidth / 2;
		const x0 = rect.x + inset;
		const y0 = rect.y + inset;
		const x1 = rect.x + Math.max(0, rect.width - inset);
		const y1 = rect.y + Math.max(0, rect.height - inset);

		this.#rapid.drawLine({
			points: [new Vec2(x0, y0), new Vec2(x1, y0), new Vec2(x1, y1), new Vec2(x0, y1)],
			closed: true,
			width: lineWidth,
			color: DEBUG_LIMEGREEN
		});
	}

	endFrame(): void {
		if (this.#destroyed) {
			return;
		}
		this.#rapid.flush();
	}

	evictTile(key: string): void {
		if (this.#destroyed) {
			return;
		}
		const texture = this.#textures.get(key);
		if (!texture) {
			return;
		}
		this.#textures.delete(key);
		this.#rapid.texture.destroy(texture, true);
	}

	clearTiles(): void {
		if (this.#destroyed) {
			return;
		}
		this.#textures.clear();
		this.#rapid.texture.destroyAll();
	}

	destroy(): void {
		if (this.#destroyed) {
			return;
		}
		this.#destroyed = true;
		this.#textures.clear();
		this.#rapid.texture.destroyAll();
		this.#rapid.gl.getExtension('WEBGL_lose_context')?.loseContext();
		this.#canvas.width = 1;
		this.#canvas.height = 1;
	}
}

/** Software/2D fallback surface when WebGL2 is unavailable (e.g. headless environments or tests). */
class Canvas2DSurface implements RenderSurface {
	readonly kind = '2d';
	readonly #canvas: AnyCanvas;
	readonly #ctx: AnyCanvas2DContext | null;

	constructor(canvas: AnyCanvas) {
		this.#canvas = canvas;
		this.#ctx = canvas.getContext('2d');
	}

	resize(width: number, height: number): void {
		if (width <= 0 || height <= 0) {
			return;
		}
		if (this.#canvas.width !== width) {
			this.#canvas.width = width;
		}
		if (this.#canvas.height !== height) {
			this.#canvas.height = height;
		}
	}

	clear(): void {
		if (!this.#ctx || this.#canvas.width <= 0 || this.#canvas.height <= 0) {
			return;
		}
		this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
	}

	beginFrame(): void {
		if (!this.#ctx || this.#canvas.width <= 0 || this.#canvas.height <= 0) {
			return;
		}
		this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
		this.#ctx.imageSmoothingEnabled = true;
	}

	hasTile(): boolean {
		// Canvas 2D draws directly from `ImageBitmap` with no separate GPU texture upload step.
		return true;
	}

	uploadTile(): void {
		// No-op for 2D contexts.
	}

	drawTile(_key: string, bitmap: ImageBitmap | undefined, rect: Rect, alpha: number): void {
		if (!this.#ctx || !bitmap) {
			return;
		}
		this.#ctx.globalAlpha = alpha;
		this.#ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
	}

	drawDebugOutline(rect: Rect, lineWidth: number): void {
		if (!this.#ctx) {
			return;
		}
		const inset = lineWidth / 2;
		this.#ctx.globalAlpha = 1;
		this.#ctx.strokeStyle = 'limegreen';
		this.#ctx.lineWidth = lineWidth;
		this.#ctx.strokeRect(
			rect.x + inset,
			rect.y + inset,
			Math.max(0, rect.width - lineWidth),
			Math.max(0, rect.height - lineWidth)
		);
	}

	endFrame(): void {
		if (this.#ctx) {
			this.#ctx.globalAlpha = 1;
		}
	}

	evictTile(): void {
		// Canvas 2D draws straight from the renderer's bitmaps, so there is no texture to free.
	}

	clearTiles(): void {
		// The renderer closes its own bitmaps; there is nothing held here.
	}

	destroy(): void {
		// Shrink the canvas to 1×1 so iOS Safari immediately frees the underlying IOSurface allocation.
		this.#canvas.width = 1;
		this.#canvas.height = 1;
		this.#ctx?.clearRect(0, 0, 1, 1);
	}
}

/**
 * Creates the best available rendering surface for `canvas`: WebGL2 via `rapid-render` when
 * supported, falling back transparently to a 2D canvas context otherwise.
 */
export function createRenderSurface(canvas: AnyCanvas): RenderSurface {
	try {
		return new RapidWebGLSurface(canvas);
	} catch {
		return new Canvas2DSurface(canvas);
	}
}
