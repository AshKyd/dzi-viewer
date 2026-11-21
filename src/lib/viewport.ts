import type {
	DziDescriptor,
	Padding,
	Point,
	Rect,
	Size,
	Viewport,
	ViewportConstraints,
	ViewportFitOptions,
	ViewportTolerance
} from './types.js';

interface NormalisedPadding {
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly left: number;
}

export function normalisePadding(padding?: Padding): NormalisedPadding {
	if (padding === undefined) {
		return { top: 0, right: 0, bottom: 0, left: 0 };
	}

	if (typeof padding === 'number') {
		const value = Math.max(0, padding);
		return { top: value, right: value, bottom: value, left: value };
	}

	return {
		top: Math.max(0, padding.top ?? 0),
		right: Math.max(0, padding.right ?? 0),
		bottom: Math.max(0, padding.bottom ?? 0),
		left: Math.max(0, padding.left ?? 0)
	};
}

/**
 * Resolves the virtual stage size and DZI placement rectangle without distorting the image's aspect ratio.
 * When `stageSize` is provided without `imageBounds`, the DZI is centred and fitted inside `stageSize`.
 */
export function resolveStageAndImageBounds(
	dzi: Pick<DziDescriptor, 'width' | 'height'>,
	stageSize?: Size,
	imageBounds?: Rect
): { readonly stageSize: Size; readonly imageBounds: Rect } {
	if (imageBounds) {
		const resolvedStageSize = stageSize ?? {
			width: Math.max(imageBounds.width, imageBounds.x + imageBounds.width),
			height: Math.max(imageBounds.height, imageBounds.y + imageBounds.height)
		};
		return { stageSize: resolvedStageSize, imageBounds };
	}

	if (stageSize && stageSize.width > 0 && stageSize.height > 0 && dzi.width > 0 && dzi.height > 0) {
		const scale = Math.min(stageSize.width / dzi.width, stageSize.height / dzi.height);
		const width = dzi.width * scale;
		const height = dzi.height * scale;
		return {
			stageSize,
			imageBounds: {
				x: (stageSize.width - width) / 2,
				y: (stageSize.height - height) / 2,
				width,
				height
			}
		};
	}

	return {
		stageSize: { width: dzi.width, height: dzi.height },
		imageBounds: { x: 0, y: 0, width: dzi.width, height: dzi.height }
	};
}

function computeBoundedViewport(
	bounds: Rect,
	containerSize: Size,
	mode: 'fit' | 'fill',
	options?: ViewportFitOptions
): Viewport {
	const boundsCentreX = bounds.x + bounds.width / 2;
	const boundsCentreY = bounds.y + bounds.height / 2;

	if (
		bounds.width <= 0 ||
		bounds.height <= 0 ||
		containerSize.width <= 0 ||
		containerSize.height <= 0
	) {
		return { x: boundsCentreX, y: boundsCentreY, zoom: 1 };
	}

	const pad = normalisePadding(options?.padding);
	const availableWidth = Math.max(1, containerSize.width - pad.left - pad.right);
	const availableHeight = Math.max(1, containerSize.height - pad.top - pad.bottom);

	const scaleX = availableWidth / bounds.width;
	const scaleY = availableHeight / bounds.height;
	const zoom = mode === 'fit' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);

	// Shift the viewport centre opposite any asymmetric padding so the bounds sit centred inside the padded box.
	const offsetX = (pad.left - pad.right) / (2 * zoom);
	const offsetY = (pad.top - pad.bottom) / (2 * zoom);

	return {
		x: boundsCentreX - offsetX,
		y: boundsCentreY - offsetY,
		zoom
	};
}

/**
 * Returns the viewport that fits `bounds` entirely inside `containerSize` (contain behaviour).
 */
export function getFitViewport(
	bounds: Rect,
	containerSize: Size,
	options?: ViewportFitOptions
): Viewport {
	return computeBoundedViewport(bounds, containerSize, 'fit', options);
}

/**
 * Returns the viewport that fills `containerSize` completely with `bounds` (cover behaviour).
 */
export function getFillViewport(
	bounds: Rect,
	containerSize: Size,
	options?: ViewportFitOptions
): Viewport {
	return computeBoundedViewport(bounds, containerSize, 'fill', options);
}

/**
 * Returns the visible rectangle in virtual stage coordinates for the given viewport and container.
 */
export function getViewportBounds(viewport: Viewport, containerSize: Size): Rect {
	if (viewport.zoom <= 0 || containerSize.width <= 0 || containerSize.height <= 0) {
		return { x: viewport.x, y: viewport.y, width: 0, height: 0 };
	}

	const width = containerSize.width / viewport.zoom;
	const height = containerSize.height / viewport.zoom;

	return {
		x: viewport.x - width / 2,
		y: viewport.y - height / 2,
		width,
		height
	};
}

function clampAxisCentre(
	centre: number,
	visibleSpan: number,
	boundsStart: number,
	boundsSpan: number,
	visibilityRatio: number
): number {
	// `requiredOverlap` never exceeds either span, so `minCentre <= maxCentre` always holds.
	const requiredOverlap = Math.min(boundsSpan, visibleSpan) * visibilityRatio;
	const minCentre = boundsStart + requiredOverlap - visibleSpan / 2;
	const maxCentre = boundsStart + boundsSpan - requiredOverlap + visibleSpan / 2;

	return Math.min(maxCentre, Math.max(minCentre, centre));
}

/**
 * Clamps a viewport to optional zoom limits and stage bounds visibility constraints.
 */
export function clampViewport(
	viewport: Viewport,
	constraints: ViewportConstraints | undefined,
	containerSize: Size
): Viewport {
	if (!constraints) {
		return viewport;
	}

	const minZoom = constraints.minZoom ?? 0;
	const maxZoom = constraints.maxZoom ?? Number.POSITIVE_INFINITY;
	const clampedZoom = Math.min(maxZoom, Math.max(minZoom, viewport.zoom));

	if (
		!constraints.bounds ||
		clampedZoom <= 0 ||
		containerSize.width <= 0 ||
		containerSize.height <= 0
	) {
		return { x: viewport.x, y: viewport.y, zoom: clampedZoom };
	}

	const ratio = Math.min(1, Math.max(0, constraints.minVisibilityRatio ?? 1));
	const visibleWidth = containerSize.width / clampedZoom;
	const visibleHeight = containerSize.height / clampedZoom;

	return {
		x: clampAxisCentre(
			viewport.x,
			visibleWidth,
			constraints.bounds.x,
			constraints.bounds.width,
			ratio
		),
		y: clampAxisCentre(
			viewport.y,
			visibleHeight,
			constraints.bounds.y,
			constraints.bounds.height,
			ratio
		),
		zoom: clampedZoom
	};
}

export function stageToScreen(point: Point, viewport: Viewport, containerSize: Size): Point {
	return {
		x: containerSize.width / 2 + (point.x - viewport.x) * viewport.zoom,
		y: containerSize.height / 2 + (point.y - viewport.y) * viewport.zoom
	};
}

export function screenToStage(point: Point, viewport: Viewport, containerSize: Size): Point {
	if (viewport.zoom <= 0) {
		return { x: viewport.x, y: viewport.y };
	}

	return {
		x: viewport.x + (point.x - containerSize.width / 2) / viewport.zoom,
		y: viewport.y + (point.y - containerSize.height / 2) / viewport.zoom
	};
}

/**
 * Projects a stage-space rectangle into CSS pixels relative to the viewer container.
 */
export function stageRectToScreen(rect: Rect, viewport: Viewport, containerSize: Size): Rect {
	const topLeft = stageToScreen({ x: rect.x, y: rect.y }, viewport, containerSize);
	return {
		x: topLeft.x,
		y: topLeft.y,
		width: rect.width * viewport.zoom,
		height: rect.height * viewport.zoom
	};
}

/**
 * Returns an inline CSS style string positioning an overlay element over `rect` in stage space.
 */
export function stageRectToStyle(rect: Rect, viewport: Viewport, containerSize: Size): string {
	const { x, y, width, height } = stageRectToScreen(rect, viewport, containerSize);
	return `position: absolute; top: 0; left: 0; transform: translate3d(${x}px, ${y}px, 0); width: ${width}px; height: ${height}px;`;
}

/**
 * Compares two viewports within optional position (stage units) and relative zoom tolerances.
 */
export function viewportsEqual(a: Viewport, b: Viewport, tolerance?: ViewportTolerance): boolean {
	const positionTolerance = tolerance?.position ?? 0.01;
	const zoomTolerance = (tolerance?.zoom ?? 1e-6) * Math.max(1, a.zoom, b.zoom);
	return (
		Math.abs(a.x - b.x) < positionTolerance &&
		Math.abs(a.y - b.y) < positionTolerance &&
		Math.abs(a.zoom - b.zoom) < zoomTolerance
	);
}

export function rectIntersects(a: Rect, b: Rect, epsilon = 0): boolean {
	return (
		a.x + a.width > b.x + epsilon &&
		a.x < b.x + b.width - epsilon &&
		a.y + a.height > b.y + epsilon &&
		a.y < b.y + b.height - epsilon
	);
}

export function rectIntersection(a: Rect, b: Rect): Rect | null {
	const left = Math.max(a.x, b.x);
	const top = Math.max(a.y, b.y);
	const right = Math.min(a.x + a.width, b.x + b.width);
	const bottom = Math.min(a.y + a.height, b.y + b.height);

	if (right <= left || bottom <= top) {
		return null;
	}

	return {
		x: left,
		y: top,
		width: right - left,
		height: bottom - top
	};
}
