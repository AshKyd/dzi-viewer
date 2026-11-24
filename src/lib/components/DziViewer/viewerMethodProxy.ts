import { EMPTY_PRECACHE_RESULT } from '../../precache.js';
import type { Size, Viewport } from '../../types.js';
import { screenToStage, stageToScreen } from '../../viewport.js';
import type { DziViewerMethods } from './dziViewerTypes.js';

/** State a wrapper can answer from before (or after) its inner `DziViewer` is mounted. */
export interface ViewerFallbackState {
	getViewport(): Viewport;
	getContainerSize(): Size;
	setViewport(viewport: Partial<Viewport>): void;
}

/**
 * Forwards every `DziViewerMethods` call to the inner viewer once it exists.
 * `PanZoom` and the vanilla controllers wrap a `DziViewer` and must expose the same methods; until it
 * mounts, viewport calls go to `fallback` and loading calls do nothing.
 */
export function createViewerMethodProxy(
	getViewer: () => DziViewerMethods | undefined,
	fallback: ViewerFallbackState
): DziViewerMethods {
	return {
		setViewport: (viewport) => {
			const viewer = getViewer();
			if (viewer) {
				viewer.setViewport(viewport);
				return;
			}
			fallback.setViewport(viewport);
		},
		getViewport: () => getViewer()?.getViewport() ?? fallback.getViewport(),
		getImageBounds: () => getViewer()?.getImageBounds() ?? null,
		getContainerSize: () => getViewer()?.getContainerSize() ?? fallback.getContainerSize(),
		subscribe: (listener) => getViewer()?.subscribe(listener) ?? (() => undefined),
		getFitViewport: (bounds, options) => getViewer()?.getFitViewport(bounds, options) ?? null,
		getFillViewport: (bounds, options) => getViewer()?.getFillViewport(bounds, options) ?? null,
		precacheViewport: (viewport, options) =>
			getViewer()?.precacheViewport(viewport, options) ?? Promise.resolve(EMPTY_PRECACHE_RESULT),
		precacheBounds: (bounds, mode, options) =>
			getViewer()?.precacheBounds(bounds, mode, options) ?? Promise.resolve(EMPTY_PRECACHE_RESULT),
		stageToScreen: (point) =>
			getViewer()?.stageToScreen(point) ??
			stageToScreen(point, fallback.getViewport(), fallback.getContainerSize()),
		screenToStage: (point) =>
			getViewer()?.screenToStage(point) ??
			screenToStage(point, fallback.getViewport(), fallback.getContainerSize()),
		pauseLoading: (reason) => getViewer()?.pauseLoading(reason),
		resumeLoading: (reason) => getViewer()?.resumeLoading(reason),
		isLoadingPaused: () => getViewer()?.isLoadingPaused() ?? false,
		holdResolution: () => getViewer()?.holdResolution(),
		releaseResolution: () => getViewer()?.releaseResolution(),
		isResolutionHeld: () => getViewer()?.isResolutionHeld() ?? false
	};
}
