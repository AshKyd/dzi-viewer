import { easeCubicOut } from 'd3-ease';
import { interpolateZoom } from 'd3-interpolate';
import type {
	EasingFunction,
	InterpolateViewportOptions,
	Rect,
	Size,
	Viewport,
	ViewportTarget,
	ViewportTrackStop
} from './types.js';
import { getFillViewport, getFitViewport } from './viewport.js';

const DEFAULT_FLY_REFERENCE_SPAN = 1000;

/** Default easing for timed transitions (`d3-ease`'s `easeCubicOut`). */
export const easeOutCubic: EasingFunction = easeCubicOut;

export interface TrackSegmentMatch {
	readonly fromIndex: number;
	readonly toIndex: number;
	readonly fromStop: ViewportTrackStop;
	readonly toStop: ViewportTrackStop;
	/** Normalised progress in `[0, 1]` between `fromStop` and `toStop`. */
	readonly localProgress: number;
}

/**
 * Type guard distinguishing an explicit `{ x, y, zoom }` `Viewport` from bounds targets and resolvers.
 */
export function isViewportTargetExplicit(target: ViewportTarget): target is Viewport {
	return (
		typeof target === 'object' &&
		target !== null &&
		'x' in target &&
		'y' in target &&
		'zoom' in target
	);
}

/**
 * Resolves any `ViewportTarget` (`'fit'`, `'fill'`, `BoundsTarget`, resolver function, or explicit `Viewport`)
 * into a concrete `{ x, y, zoom }` viewport for `imageBounds` and `containerSize`.
 */
export function resolveViewportTarget(
	target: ViewportTarget,
	imageBounds: Rect,
	containerSize: Size
): Viewport {
	if (typeof target === 'function') {
		return target({ imageBounds, containerSize });
	}

	if (isViewportTargetExplicit(target)) {
		return target;
	}

	if (target === 'fit') {
		return getFitViewport(imageBounds, containerSize);
	}

	if (target === 'fill') {
		return getFillViewport(imageBounds, containerSize);
	}

	const bounds = target.bounds ?? imageBounds;
	const fitOptions = target.padding !== undefined ? { padding: target.padding } : undefined;
	return target.mode === 'fill'
		? getFillViewport(bounds, containerSize, fitOptions)
		: getFitViewport(bounds, containerSize, fitOptions);
}

function interpolateLinear(from: Viewport, to: Viewport, t: number): Viewport {
	return {
		x: from.x + (to.x - from.x) * t,
		y: from.y + (to.y - from.y) * t,
		zoom: from.zoom + (to.zoom - from.zoom) * t
	};
}

function interpolateDirect(from: Viewport, to: Viewport, t: number): Viewport {
	if (from.zoom <= 0 || to.zoom <= 0) {
		return interpolateLinear(from, to, t);
	}

	// Exponential zoom keeps perceived scale speed constant; inverse-zoom weighting prevents pan swooping.
	const zoom = from.zoom * Math.pow(to.zoom / from.zoom, t);
	const zoomDelta = Math.abs(to.zoom - from.zoom);
	const positionProgress =
		zoomDelta < 1e-6 * Math.max(from.zoom, to.zoom)
			? t
			: (1 / zoom - 1 / from.zoom) / (1 / to.zoom - 1 / from.zoom);

	return {
		x: from.x + (to.x - from.x) * positionProgress,
		y: from.y + (to.y - from.y) * positionProgress,
		zoom
	};
}

function interpolateFly(
	from: Viewport,
	to: Viewport,
	t: number,
	containerSize?: Size,
	rho?: number
): Viewport {
	if (from.zoom <= 0 || to.zoom <= 0) {
		return interpolateLinear(from, to, t);
	}

	const maxContainerSpan = containerSize
		? Math.max(containerSize.width, containerSize.height)
		: 0;
	const referenceSpan = maxContainerSpan > 0 ? maxContainerSpan : DEFAULT_FLY_REFERENCE_SPAN;

	const baseInterpolator =
		rho !== undefined && Number.isFinite(rho) && rho > 0
			? interpolateZoom.rho(rho)
			: interpolateZoom;

	const fly = baseInterpolator(
		[from.x, from.y, referenceSpan / from.zoom],
		[to.x, to.y, referenceSpan / to.zoom]
	);
	const [x, y, visibleSpan] = fly(t);

	return {
		x,
		y,
		zoom: visibleSpan > 0 ? referenceSpan / visibleSpan : to.zoom
	};
}

/**
 * Interpolates between two viewports at `progress` (clamped to `[0, 1]`).
 * Uses exponential direct zoom by default, or van Wijk & Nuij smooth pan-and-zoom with `curve: 'fly'`.
 */
export function interpolateViewport(
	from: Viewport,
	to: Viewport,
	progress: number,
	options?: InterpolateViewportOptions
): Viewport {
	const clamped = Math.min(1, Math.max(0, progress));
	const t = options?.easing ? options.easing(clamped) : clamped;

	if (clamped <= 0 && t === 0) {
		return from;
	}
	if (clamped >= 1 && t === 1) {
		return to;
	}

	if (options?.curve === 'fly') {
		return interpolateFly(from, to, t, options.containerSize, options.rho);
	}

	return interpolateDirect(from, to, t);
}

/**
 * Resolves `from` and `to` targets against `imageBounds` and `containerSize`, then interpolates between them.
 */
export function interpolateTarget(
	from: ViewportTarget,
	to: ViewportTarget,
	imageBounds: Rect,
	containerSize: Size,
	progress: number,
	options?: InterpolateViewportOptions
): Viewport {
	const resolvedFrom = resolveViewportTarget(from, imageBounds, containerSize);
	const resolvedTo = resolveViewportTarget(to, imageBounds, containerSize);

	return interpolateViewport(resolvedFrom, resolvedTo, progress, {
		...options,
		containerSize: options?.containerSize ?? containerSize
	});
}

/**
 * Locates the active pair of stops and normalised `localProgress` in `[0, 1]` for `progress`.
 * Clamps below the first stop and above the last stop. Returns `null` when `stops` is empty.
 */
export function findTrackSegment(
	stops: readonly ViewportTrackStop[],
	progress: number
): TrackSegmentMatch | null {
	if (stops.length === 0) {
		return null;
	}

	const firstStop = stops[0];
	if (stops.length === 1 || progress <= firstStop.at) {
		return {
			fromIndex: 0,
			toIndex: 0,
			fromStop: firstStop,
			toStop: firstStop,
			localProgress: 0
		};
	}

	const lastIndex = stops.length - 1;
	const lastStop = stops[lastIndex];
	if (progress >= lastStop.at) {
		return {
			fromIndex: lastIndex,
			toIndex: lastIndex,
			fromStop: lastStop,
			toStop: lastStop,
			localProgress: 1
		};
	}

	const toIndex = stops.findIndex((stop, index) => index > 0 && progress <= stop.at);
	const resolvedToIndex = toIndex === -1 ? lastIndex : toIndex;
	const fromIndex = resolvedToIndex - 1;
	const fromStop = stops[fromIndex];
	const toStop = stops[resolvedToIndex];
	const span = toStop.at - fromStop.at;

	return {
		fromIndex,
		toIndex: resolvedToIndex,
		fromStop,
		toStop,
		localProgress: span > 0 ? Math.min(1, Math.max(0, (progress - fromStop.at) / span)) : 1
	};
}

/**
 * Samples a multi-stop viewport track at `progress`, respecting per-stop `curve` and `easing` overrides.
 */
export function sampleViewportTrack(
	stops: readonly ViewportTrackStop[],
	progress: number,
	imageBounds: Rect,
	containerSize: Size,
	options?: InterpolateViewportOptions
): Viewport | null {
	const segment = findTrackSegment(stops, progress);
	if (!segment) {
		return null;
	}

	if (segment.fromIndex === segment.toIndex) {
		return resolveViewportTarget(segment.fromStop.target, imageBounds, containerSize);
	}

	return interpolateTarget(
		segment.fromStop.target,
		segment.toStop.target,
		imageBounds,
		containerSize,
		segment.localProgress,
		{
			...options,
			curve: segment.toStop.curve ?? options?.curve,
			easing: segment.toStop.easing ?? options?.easing
		}
	);
}
