# OpenSeahorse

A Deep Zoom (DZI) image viewer for Svelte 5. It loads only the tiles you can see, at the right resolution for the screen, and keeps lower-resolution tiles showing underneath while sharper ones load.

- `OpenSeahorse` shows a DZI image at a given position and zoom. You control the viewport.
- `PanZoom` wraps `OpenSeahorse` and adds drag, wheel, pinch, double-click and keyboard controls.
- `openseahorse/vanilla` mounts either viewer in any page, without Svelte (plain JS, React, Vue).

## Install

```bash
npm install openseahorse
```

Svelte 5 is a peer dependency for the Svelte components. The vanilla build bundles its own copy of the Svelte runtime.

## Svelte quick start

Give the viewer a sized container. It fills its parent.

```svelte
<script lang="ts">
	import { PanZoom, type OpenSeahorseMethods } from 'openseahorse';

	let viewer: OpenSeahorseMethods | undefined = $state();
	let x = $state(0);
	let y = $state(0);
	let zoom = $state(1);
	let dzi = $state(null);
	let containerSize = $state({ width: 0, height: 0 });
	let hasFramed = false;

	// Fit the whole image once both the image and the container size are known.
	$effect(() => {
		if (hasFramed || !dzi || containerSize.width === 0) {
			return;
		}
		const fit = viewer?.getFitViewport();
		if (fit) {
			({ x, y, zoom } = fit);
			hasFramed = true;
		}
	});
</script>

<div style="width: 100%; height: 600px">
	<PanZoom
		bind:this={viewer}
		source="/images/photo.dzi"
		alt="Harbour at dusk"
		bind:x
		bind:y
		bind:zoom
		bind:dzi
		bind:containerSize
	/>
</div>
```

Coordinates:

- `x` and `y` are the centre of the view, in stage units. By default one stage unit is one full-resolution image pixel.
- `zoom` is how many CSS pixels one stage unit takes up. `zoom = 1` shows the image at full resolution.

Use `OpenSeahorse` instead of `PanZoom` when you drive the viewport yourself, for example with a `Tween` or from scroll position.

## Vanilla quick start

```js
import { createPanZoom } from 'openseahorse/vanilla';

const viewer = createPanZoom(document.querySelector('#viewer'), {
	source: '/images/photo.dzi',
	alt: 'Harbour at dusk',
	onStateChange: ({ x, y, zoom, dzi }) => console.log(x, y, zoom, dzi)
});

viewer.setViewport({ zoom: 2 });
viewer.update({ tileFadeDuration: 0 });
viewer.destroy();
```

- `createOpenSeahorse()` does the same without the pan and zoom controls.
- `onStateChange` is called once per change made by the viewer: user gestures, resizes, and the DZI or tiles finishing loading.

## Sources

`source` accepts:

- A URL to a `.dzi` file (XML or JSON). Tiles load from the matching `_files/` folder, or from the `Url` attribute if the file has one.
- Inline DZI JSON, such as `{ Image: { Format, Overlap, TileSize, Size } }`.
- A `DziDescriptor` you have already loaded with `loadDzi()`.

To serve tiles from somewhere else, pass `getTileUrl={(level, col, row) => url}`.

## Common props

All props are optional except `source`.

- `x`, `y`, `zoom`: the viewport. Bindable.
- `constraints`: `{ minZoom, maxZoom, bounds, minVisibilityRatio }`. Limits how far the user can zoom and pan.
- `stageSize` / `imageBounds`: place the image inside a larger virtual stage, for example to lay out several images in one coordinate space.
- `maxDpr` (default `1.5`): caps the device pixel ratio used to pick tile resolution. Lower values load fewer tiles.
- `quality` (default `1`): multiplies the resolution chosen. Use `0.5` for faster, softer images.
- `tileFadeDuration` (default `200`): tile fade-in in milliseconds. `0` turns fading off.
- `maxConcurrentLoads` (default `16`): tile downloads in flight at once. Suits HTTP/2 and HTTP/3 servers. Over HTTP/1.1 the browser queues anything past about 6 per host, so lower this if the server only speaks HTTP/1.1.
- `maxCachedTiles` (default `256`): how many decoded tiles to keep in memory.
- `maxRetries` (default `1`): immediate retries for a failed tile request.
- `failedTileRetryDelay` (default `5000`): how long to wait before trying a failed, still-visible tile again. Doubles after each failure, up to 60 seconds.
- `crossOrigin`: CORS mode for tile images.
- `onLoad`, `onError`, `onTileError`: callbacks for the descriptor loading, the descriptor failing, and a tile failing.

`PanZoom` also takes `disabled`, `panEnabled`, `zoomEnabled`, `wheelZoomFactor`, `doubleClickZoomFactor`, `keyboardEnabled`, `keyboardPanStep`, `keyboardZoomFactor` and `onInteract`.

Read-only bindables: `containerSize`, `dzi` (the loaded descriptor) and `isOptimalLoaded` (true once every visible tile is loaded at the ideal resolution).

## Methods

Available through `bind:this` on either component, and on the vanilla controller:

- `getFitViewport(bounds?, { padding }?)`: the viewport that shows all of `bounds`. Defaults to the whole image.
- `getFillViewport(bounds?, { padding }?)`: the viewport where `bounds` covers the whole container.
- `precacheViewport(viewport, { signal }?)`: loads the tiles for a viewport ahead of time, for example before animating to it.
- `precacheBounds(bounds, 'fit' | 'fill', options?)`: the same, for a fit or fill view of `bounds`.
- `stageToScreen(point)` / `screenToStage(point)`: convert between stage coordinates and container pixels.
- `pauseLoading()` / `resumeLoading()` / `isLoadingPaused()`: stop and restart downloading tiles for the current view. See below.

The vanilla controller also has `update`, `setViewport`, `getViewport`, `getState` and `destroy`.

## Pausing tile downloads

By default the viewer requests tiles for every viewport it shows. During an animation, most of those viewports are on screen for a single frame. `pauseLoading()` stops new downloads until you call `resumeLoading()`. While paused:

- Tiles already downloaded still show, and lower-resolution tiles fill any gaps.
- The list of needed tiles keeps updating, so resuming only downloads what the final view needs.
- `precacheViewport()` and `precacheBounds()` keep downloading, so you can load the destination while animating towards it.
- Downloads already in progress finish.

Animate to a target:

```ts
const target = viewer.getFitViewport(detailBounds);
viewer.pauseLoading();
void viewer.precacheViewport(target);
await Promise.all([tweenX.set(target.x), tweenY.set(target.y), tweenZoom.set(target.zoom)]);
viewer.resumeLoading();
```

Debounce downloads while the user drags or zooms:

```ts
let resumeTimer: ReturnType<typeof setTimeout> | undefined;

function handleInteract() {
	viewer.pauseLoading();
	clearTimeout(resumeTimer);
	resumeTimer = setTimeout(() => viewer.resumeLoading(), 150);
}
```

Pass `handleInteract` as `PanZoom`'s `onInteract` prop.

## Development

Run each of these from the project root:

- `npm run dev`: demo page at `src/routes`.
- `npm run storybook`: component stories.
- `npm test`: unit tests in Node, then the stories in a headless Chromium browser (needs `npx playwright install chromium`).
- `npm run check`: type check with `svelte-check`.
- `npm run lint` / `npm run format`: Prettier and ESLint.
- `npm run build`: builds the package into `dist/`, including the vanilla bundle.
