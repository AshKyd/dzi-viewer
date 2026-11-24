import { mount, unmount } from 'svelte';
import DziViewer from '../components/DziViewer/DziViewer.svelte';
import type { DziViewerMethods, DziViewerProps } from '../components/DziViewer/dziViewerTypes.js';
import { createViewerMethodProxy } from '../components/DziViewer/viewerMethodProxy.js';
import PanZoom from '../components/PanZoom/PanZoom.svelte';
import type { PanZoomProps } from '../components/PanZoom/panZoomTypes.js';
import {
	ReactiveBridge,
	type StateChangeListener,
	type ViewerComponent
} from './reactiveBridge.svelte.js';
import VanillaBridge from './VanillaBridge.svelte';
import type { ViewerStateSnapshot } from './vanillaUtils.js';

export type { ViewerStateSnapshot } from './vanillaUtils.js';

export interface VanillaDziViewerOptions extends Omit<DziViewerProps, 'children'> {
	/** Called once per change to `x`, `y`, `zoom`, `containerSize`, `dzi` or `isOptimalLoaded` made by the viewer. */
	onStateChange?: StateChangeListener;
}

export interface VanillaPanZoomOptions extends Omit<PanZoomProps, 'children'> {
	/** Called once per change to `x`, `y`, `zoom`, `containerSize`, `dzi` or `isOptimalLoaded` made by the viewer. */
	onStateChange?: StateChangeListener;
}

export interface DziViewerController extends DziViewerMethods {
	/** Updates any subset of `DziViewer` props. Updating `x`, `y`, or `zoom` overrides the current viewport. */
	update: (props: Partial<VanillaDziViewerOptions>) => void;
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

	const viewerMethods = createViewerMethodProxy(() => mounted?.getViewer(), {
		getViewport: () => bridge.getViewport(),
		getContainerSize: () => bridge.getSnapshot().containerSize,
		setViewport: (viewport) => {
			if (mounted) {
				bridge.update(viewport);
			}
		}
	});

	return {
		...viewerMethods,
		update(props) {
			if (mounted) {
				bridge.update(props);
			}
		},
		getState: () => bridge.getSnapshot(),
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
