export { default as DziViewer } from './components/DziViewer/DziViewer.svelte';
export { default as PanZoom } from './components/PanZoom/PanZoom.svelte';

export { createDziViewer, createPanZoom } from './vanilla/createViewer.js';
export type {
	DziViewerController,
	PanZoomController,
	VanillaDziViewerOptions,
	VanillaPanZoomOptions,
	ViewerStateSnapshot
} from './vanilla/createViewer.js';

export * from './core.js';
