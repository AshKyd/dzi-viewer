<script lang="ts">
	import type { DziViewerMethods } from '../components/DziViewer/dziViewerTypes.js';
	import type { ReactiveBridge, ViewerComponent } from './reactiveBridge.svelte.js';

	interface Props {
		/** Viewer to mount: `DziViewer` or `PanZoom`. */
		component: ViewerComponent;
		/** Shared state written by the vanilla controller and read back from the viewer. */
		bridge: ReactiveBridge;
	}

	let { component: Viewer, bridge }: Props = $props();
	let viewer: DziViewerMethods | undefined = $state();

	/** The mounted viewer's methods, once it has mounted. */
	export function getViewer(): DziViewerMethods | undefined {
		return viewer;
	}
</script>

<Viewer
	bind:this={viewer}
	bind:x={() => bridge.x, (value) => bridge.set('x', value)}
	bind:y={() => bridge.y, (value) => bridge.set('y', value)}
	bind:zoom={() => bridge.zoom, (value) => bridge.set('zoom', value)}
	bind:containerSize={() => bridge.containerSize, (value) => bridge.set('containerSize', value)}
	bind:dzi={() => bridge.dzi, (value) => bridge.set('dzi', value)}
	bind:isOptimalLoaded={
		() => bridge.isOptimalLoaded, (value) => bridge.set('isOptimalLoaded', value)
	}
	{...bridge.rest}
/>
