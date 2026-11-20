import { mount, unmount } from 'svelte';
import DziViewer from '../components/DziViewer/DziViewer.svelte';
import type { DziViewerMethods, DziViewerProps } from '../components/DziViewer/dziViewerTypes.js';
import PanZoom from '../components/PanZoom/PanZoom.svelte';
import type { PanZoomProps } from '../components/PanZoom/panZoomTypes.js';
import { EMPTY_PRECACHE_RESULT } from '../precache.js';
import type { Viewport } from '../types.js';
import {
	ReactiveBridge,
	type StateChangeListener,
	type ViewerComponent
} from './reactiveBridge.svelte.js';
import VanillaBridge from './VanillaBridge.svelte';
import type { ViewerStateSnapshot } from './vanillaUtils.js';

export type { ViewerStateSnapshot } from './vanillaUtils.js';

export interface VanillaDziViewerOptions extends DziViewerProps {
	/** Called once per change to `x`, `y`, `zoom`, `containerSize`, `dzi` or `isOptimalLoaded` made by the viewer. */
	onStateChange?: StateChangeListener;
}

export interface VanillaPanZoomOptions extends PanZoomProps {
	/** Called once per change to `x`, `y`, `zoom`, `containerSize`, `dzi` or `isOptimalLoaded` made by the viewer. */
	onStateChange?: StateChangeListener;
}

export interface DziViewerController extends DziViewerMethods {
	/** Updates any subset of `DziViewer` props. Updating `x`, `y`, or `zoom` overrides the current viewport. */
	update: (props: Partial<VanillaDziViewerOptions>) => void;
	/** Sets the viewport centre and/or zoom. */
	setViewport: (viewport: Partial<Viewport>) => void;
	/** Returns the current `{ x, y, zoom }` viewport. */
	getViewport: () => Viewport;
	/** Returns the current viewer state snapshot. */
	getState: () => ViewerStateSnapshot;
	/** Unmounts the viewer from its target DOM element. */
	destroy: () => void;
}

export interface PanZoomController extends Omit<DziViewerController, 'update'> {
	/** Updates any subset of `PanZoom` or `DziViewer` props. Updating `x`, `y`, or `zoom` overrides the current position. */
	update: (props: Partial<VanillaPanZoomOptions>) => void;
}

/** What `mount(VanillaBridge)` returns: the bridge's exported functions. */
interface MountedBridge {
	getViewer: () => DziViewerMethods | undefined;
}

/**
 * Mounts `component` through `VanillaBridge` and returns the imperative controller.
 * Every method is a no-op (or returns an empty result) after `destroy()`.
 */
function createController(
	component: ViewerComponent,
	target: HTMLElement,
	options: VanillaPanZoomOptions
): PanZoomController {
	const bridge = new ReactiveBridge(options);
	let mounted: MountedBridge | null = mount(VanillaBridge, {
		target,
		props: { component, bridge }
	}) as MountedBridge;

	const viewer = () => mounted?.getViewer();

	return {
		update(props) {
			if (mounted) {
				bridge.update(props);
			}
		},
		setViewport(viewport) {
			if (mounted) {
				bridge.update(viewport);
			}
		},
		getViewport: () => bridge.getViewport(),
		getState: () => bridge.getSnapshot(),
		getFitViewport: (bounds, fitOptions) => viewer()?.getFitViewport(bounds, fitOptions) ?? null,
		getFillViewport: (bounds, fitOptions) => viewer()?.getFillViewport(bounds, fitOptions) ?? null,
		precacheViewport: (targetViewport, precacheOptions) =>
			viewer()?.precacheViewport(targetViewport, precacheOptions) ??
			Promise.resolve(EMPTY_PRECACHE_RESULT),
		precacheBounds: (bounds, mode, precacheOptions) =>
			viewer()?.precacheBounds(bounds, mode, precacheOptions) ??
			Promise.resolve(EMPTY_PRECACHE_RESULT),
		stageToScreen: (point) => viewer()?.stageToScreen(point) ?? point,
		screenToStage: (point) => viewer()?.screenToStage(point) ?? point,
		pauseLoading: () => viewer()?.pauseLoading(),
		resumeLoading: () => viewer()?.resumeLoading(),
		isLoadingPaused: () => viewer()?.isLoadingPaused() ?? false,
		holdResolution: () => viewer()?.holdResolution(),
		releaseResolution: () => viewer()?.releaseResolution(),
		isResolutionHeld: () => viewer()?.isResolutionHeld() ?? false,
		destroy() {
			if (!mounted) {
				return;
			}
			const instance = mounted;
			mounted = null;
			void unmount(instance);
		}
	};
}

/**
 * Mounts a `DziViewer` into any DOM element for non-Svelte applications.
 * All `DziViewer` props are passed through and can be updated at any time via `update()`.
 */
export function createDziViewer(
	target: HTMLElement,
	options: VanillaDziViewerOptions
): DziViewerController {
	return createController(DziViewer, target, options);
}

/**
 * Mounts an interactive `PanZoom` viewer into any DOM element for non-Svelte applications.
 * All `PanZoom` and `DziViewer` props are passed through and can be updated via `update()`.
 */
export function createPanZoom(
	target: HTMLElement,
	options: VanillaPanZoomOptions
): PanZoomController {
	return createController(PanZoom, target, options);
}
