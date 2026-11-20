<script lang="ts">
	import type { OpenSeahorseMethods } from '../components/OpenSeahorse/openSeahorseTypes.js';
	import type { ReactiveBridge, ViewerComponent } from './reactiveBridge.svelte.js';

	interface Props {
		/** Viewer to mount: `OpenSeahorse` or `PanZoom`. */
		component: ViewerComponent;
		/** Shared state written by the vanilla controller and read back from the viewer. */
		bridge: ReactiveBridge;
	}

	let { component: Viewer, bridge }: Props = $props();
	let viewer: OpenSeahorseMethods | undefined = $state();

	/** The mounted viewer's methods, once it has mounted. */
	export function getViewer(): OpenSeahorseMethods | undefined {
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
