# dzi-viewer

A Deep Zoom (DZI) image viewer for Svelte 5. It loads only the tiles you can see, at the right resolution for the screen, and keeps lower-resolution tiles showing underneath while sharper ones load.

- `DziViewer` shows a DZI image at a given position and zoom. You control the viewport.
- `PanZoom` wraps `DziViewer` and adds drag, wheel, pinch, double-click and keyboard controls.
- `dzi-viewer/vanilla` mounts either viewer in any page, without Svelte (plain JS, React, Vue).

## Install

```bash
npm install dzi-viewer
```

Svelte 5 is a peer dependency for the Svelte components. The vanilla build bundles its own copy of the Svelte runtime.

## Svelte quick start

Give the viewer a sized container. It fills its parent.

```svelte
<script lang="ts">
	import { PanZoom } from 'dzi-viewer';
</script>

<div style="width: 100%; height: 600px">
	<PanZoom
		source="/images/photo.dzi"
		initialView="fit"
		loadDebounceMs={150}
		alt="Harbour at dusk"
	/>
</div>
```

Coordinates:

- `x` and `y` are the centre of the view, in stage units. By default one stage unit is one full-resolution image pixel.
- `zoom` is how many CSS pixels one stage unit takes up. `zoom = 1` shows the image at full resolution.

Use `DziViewer` instead of `PanZoom` when you drive the viewport yourself, for example with a `Tween` or from scroll position.

## Vanilla quick start

```js
import { createPanZoom } from 'dzi-viewer/vanilla';

const viewer = createPanZoom(document.querySelector('#viewer'), {
	source: '/images/photo.dzi',
	initialView: 'fit',
	alt: 'Harbour at dusk',
	onStateChange: ({ x, y, zoom, dzi }) => console.log(x, y, zoom, dzi)
});

viewer.setViewport({ zoom: 2 });
viewer.update({ tileFadeDuration: 0 });
viewer.destroy();
```

- `createDziViewer()` does the same without the pan and zoom controls.
- `onStateChange` is called once per change made by the viewer: user gestures, resizes, and the DZI or tiles finishing loading.
- `dzi-viewer/vanilla` also exports `createCamera()` and all pure viewport, transition, and overlay helpers.

## Sources

`source` accepts:

- A URL to a `.dzi` file (XML or JSON). Tiles load from the matching `_files/` folder, or from the `Url` attribute if the file has one.
- Inline DZI JSON, such as `{ Image: { Format, Overlap, TileSize, Size } }`.
- A `DziDescriptor` you have already loaded with `loadDzi()`.
- `null`, `undefined`, or `''` to clear the viewer without fetching.

To serve tiles from somewhere else, pass `getTileUrl={(level, col, row) => url}`.

## Common props

All props are optional.

- `source`: DZI source input, or `null`/`''` to clear.
- `initialView`: viewport target applied once per `source` as soon as both `dzi` and `containerSize` are known, before tile loads start. Accepts `'fit'`, `'fill'`, `{ bounds?, mode?, padding? }`, an explicit `{ x, y, zoom }`, or a resolver `({ imageBounds, containerSize }) => Viewport`.
- `children` (Svelte only): snippet rendered in an overlay layer above all tiles. Receives `{ viewport, containerSize, dzi, imageBounds, stageToScreen, screenToStage, stageRectToScreen, stageRectToStyle }`. The overlay layer has `pointer-events: none`; set `pointer-events: auto` on interactive overlay elements and call `event.stopPropagation()` on `pointerdown` to prevent `PanZoom` drags while keeping wheel zoom working.
- `x`, `y`, `zoom`: the viewport. Bindable.
- `constraints`: `{ minZoom, maxZoom, bounds, minVisibilityRatio }`. Limits how far the user can zoom and pan.
- `stageSize` / `imageBounds`: place the image inside a larger virtual stage, for example to lay out several images in one coordinate space.
- `maxDpr` (default `1.5`): caps the device pixel ratio used to pick tile resolution. Lower values load fewer tiles.
- `quality` (default `1`): multiplies the resolution chosen. Use `0.5` for faster, softer images.
- `tileFadeDuration` (default `200`): tile fade-in in milliseconds. `0` turns fading off.
- `maxTileMountsPerFrame` (default `8`): most new tiles added to the page per frame. Removals get twice this. When a zoom lands and a whole level swaps in, the rest wait for later frames while coarser tiles keep showing. `Infinity` turns the limit off.
- `maxConcurrentLoads` (default `16`): tile downloads in flight at once. Suits HTTP/2 and HTTP/3 servers. Over HTTP/1.1 the browser queues anything past about 6 per host, so lower this if the server only speaks HTTP/1.1.
- `maxCachedTiles` (default `256`): how many decoded tiles to keep in memory.
- `maxRetries` (default `1`): immediate retries for a failed tile request.
- `failedTileRetryDelay` (default `5000`): how long to wait before trying a failed, still-visible tile again. Doubles after each failure, up to 60 seconds.
- `crossOrigin`: CORS mode for tile images.
- `onLoad`, `onError`, `onTileError`: callbacks for the descriptor loading, the descriptor failing, and a tile failing.

`PanZoom` also takes `disabled`, `panEnabled`, `zoomEnabled`, `wheelZoomFactor`, `doubleClickZoomFactor`, `keyboardEnabled`, `keyboardPanStep`, `keyboardZoomFactor`, `loadDebounceMs` (default `0`, pauses tile downloads until gestures stop for the given ms), and `onInteract`.

Set `cooperativeGestures` on `PanZoom` when the viewer sits in a scrolling page, so it doesn't capture the page's scroll:

- The mouse wheel only zooms with Ctrl (or ⌘ on a Mac) held. A plain scroll scrolls the page.
- On touch screens, one finger scrolls the page and two fingers pan and zoom.
- A short hint appears over the viewer when a scroll or one-finger drag passes through. Change its text with `cooperativeGestureMessages` (`{ wheel, wheelMac, touch }`).
- Mouse drag, trackpad pinch, double-click and the keyboard work as normal.

Read-only bindables: `containerSize`, `dzi` (the loaded descriptor) and `isOptimalLoaded` (true once every visible tile is loaded at the ideal resolution).

## Methods

Available through `bind:this` on either component, and on the vanilla controller:

- `setViewport(viewport)`: updates any subset of `x`, `y`, and `zoom`.
- `getViewport()`: returns the currently rendered (clamped) `{ x, y, zoom }`.
- `getImageBounds()`: returns the resolved stage-space image rectangle, or `null` before load.
- `getContainerSize()`: returns the measured container `{ width, height }`.
- `subscribe(listener)`: listens to lifecycle events (`load`, `resize`, `source-change`, `interact`, `destroy`). Returns an unsubscribe function.
- `getFitViewport(bounds?, { padding }?)`: the viewport that shows all of `bounds`. Defaults to the whole image.
- `getFillViewport(bounds?, { padding }?)`: the viewport where `bounds` covers the whole container.
- `precacheViewport(viewport, { signal }?)`: loads the tiles for a viewport ahead of time, for example before animating to it.
- `precacheBounds(bounds, 'fit' | 'fill', options?)`: the same, for a fit or fill view of `bounds`.
- `stageToScreen(point)` / `screenToStage(point)`: convert between stage coordinates and container pixels.
- `pauseLoading(reason?)` / `resumeLoading(reason?)` / `isLoadingPaused()`: stop and restart downloading tiles for the current view. Optional `reason` tokens isolate independent callers. See below.
- `holdResolution()` / `releaseResolution()` / `isResolutionHeld()`: stop and restart switching to sharper pyramid levels. See below.

The vanilla controller also has `update`, `getState`, and `destroy`.

## Camera transitions & scrubbing

`createCamera(viewer, options?)` drives timed transitions and scroll-linked scrubbing while handling loading pauses, resolution holds, destination precaching, `prefers-reduced-motion`, resize refitting, and cancellation on user interaction. Exported from both `dzi-viewer` and `dzi-viewer/vanilla`. Works with Svelte `bind:this` references (pass a getter `() => viewer`) and vanilla controllers.

```svelte
<script lang="ts">
	import { createCamera, DziViewer, type DziViewerMethods } from 'dzi-viewer';

	let viewer: DziViewerMethods | undefined = $state();
	const camera = createCamera(() => viewer, {
		curve: 'fly',
		duration: 800,
		refitOnResize: true
	});

	$effect(() => () => camera.destroy());
</script>

<DziViewer bind:this={viewer} source="/images/photo.dzi" initialView="fit">
	{#snippet children({ imageBounds, stageRectToStyle })}
		{#if imageBounds}
			<img src="/images/annotations.svg" alt="" style={stageRectToStyle(imageBounds)} />
		{/if}
	{/snippet}
</DziViewer>
```

`CameraOptions` (all optional):

- `curve` (default `'direct'`): `'direct'` for exponential zoom straight to the target, or `'fly'` for a van Wijk & Nuij smooth pan-and-zoom arc via `d3-interpolate`.
- `rho`: curvature factor for `'fly'` transitions (`interpolateZoom.rho(rho)`).
- `easing`: easing for timed `goTo` transitions (default `easeOutCubic`). Not inherited by `scrub`/`scrubTrack`, which default to linear.
- `duration` (default `600`): transition duration in milliseconds.
- `respectReducedMotion` (default `true`): snap immediately when `prefers-reduced-motion: reduce` matches.
- `refitOnResize` (default `false`): re-frame the last non-explicit `goTo` target or `scrub`/`scrubTrack` position when the viewer resizes. Accepts a boolean or `() => boolean` getter.
- `settleDelayMs` (default `120`): delay after the last `scrub`/`scrubTrack` call before releasing holds.
- `pauseLoading` (default `true`), `holdResolution` (default `true`), `precache` (default `true`): toggle automatic loading control during transitions and scrubs.
- `onTransitionChange`: callback invoked with `(isTransitioning: boolean)` whenever `isTransitioning` changes.

`DziCamera` properties and methods:

- `isTransitioning`: read-only boolean, `true` while a `goTo` animation is running or a scrub is waiting to settle.
- `goTo(target, options?)`: animates (or snaps if `duration: 0` or reduced motion is enabled) to any `ViewportTarget`. Non-explicit targets called before the DZI or container size is ready queue and snap once both are known. `options` (`TransitionOptions`) overrides `duration`, `curve`, `easing`, `rho`, `respectReducedMotion`, `pauseLoading`, `holdResolution`, `precache`, and accepts an `AbortSignal` via `signal`. Returns `Promise<{ completed, cancelled, viewport }>`.
- `fitBounds(bounds?, options?)` / `fillBounds(bounds?, options?)`: shorthands for `goTo`; `options` also accepts `padding`.
- `scrub(from, to, progress, options?)`: interpolates between two targets at `progress` in `[0, 1]` (linear by default), holds resolution and downloads while scrubbing, precaches once per segment (`precache: 'to' | 'both' | false`), and releases holds after `settleDelayMs`. `options` (`ScrubOptions`) overrides `curve`, `easing`, `rho`, `settleDelayMs`, `pauseLoading`, `holdResolution`, and `precache`. Returns the applied `Viewport`, or `null` if the viewer is not ready.
- `scrubTrack(stops, progress, options?)`: scrubs across an array of `{ at, target, curve?, easing? }` stops. Returns `Viewport | null`.
- `cancel()` / `destroy()`: stops active transitions and releases holds.

Pure helpers exported for custom animation loops or overlays:

- `stageRectToScreen(rect, viewport, containerSize)` / `stageRectToStyle(rect, viewport, containerSize)`
- `viewportsEqual(a, b, tolerance?)`
- `resolveViewportTarget(target, imageBounds, containerSize)` / `isViewportTargetExplicit(target)`
- `interpolateViewport(from, to, progress, options?)` / `interpolateTarget(from, to, imageBounds, containerSize, progress, options?)`
- `findTrackSegment(stops, progress)` / `sampleViewportTrack(stops, progress, imageBounds, containerSize, options?)`
- `easeOutCubic` (`d3-ease`'s `easeCubicOut`)

## Pausing tile downloads

By default the viewer requests tiles for every viewport it shows. During an animation or rapid gesture, most of those viewports are on screen for a single frame. For `PanZoom` gestures set `loadDebounceMs`, and for timed transitions or scrubbing use `createCamera()`. Reach for `pauseLoading(reason?)` and `resumeLoading(reason?)` directly when driving your own animation loop or custom trigger.

While paused:

- Tiles already downloaded still show, and lower-resolution tiles fill any gaps.
- The list of needed tiles keeps updating, so resuming only downloads what the final view needs.
- `precacheViewport()` and `precacheBounds()` keep downloading, so you can load the destination while animating towards it.
- Downloads already in progress finish.
- Pauses are tracked by `reason` token (default `'default'`), so loading only resumes once every active reason has been resumed. Independent callers (such as `loadDebounceMs` and `createCamera()`) do not cancel each other's pause.

Manual animation example:

```ts
const target = viewer.getFitViewport(detailBounds);
viewer.pauseLoading('tween');
void viewer.precacheViewport(target);
await Promise.all([tweenX.set(target.x), tweenY.set(target.y), tweenZoom.set(target.zoom)]);
viewer.resumeLoading('tween');
```

## Holding the resolution

As you zoom, the viewer switches to the pyramid level that matches the new scale, and every switch mounts a new set of tiles. During a fast zoom it can pass through several levels in under a second. `holdResolution()` keeps the current level until `releaseResolution()` (handled automatically by `createCamera()`):

- Zooming in shows the held level enlarged (softer) instead of mounting sharper tiles.
- Zooming out still switches to coarser levels, so the number of tiles stays low.
- Tile downloads for the held level carry on, unless loading is also paused.

Holding and pausing are separate, so you can combine them:

- **Pause only:** no downloads, but in-between zoom levels still show from tiles already downloaded.
- **Hold only:** no level switching, but tiles for the held level keep downloading.
- **Both:** the cheapest option for animations.

```ts
const target = viewer.getFitViewport(detailBounds);
viewer.pauseLoading();
viewer.holdResolution();
void viewer.precacheViewport(target);
await Promise.all([tweenX.set(target.x), tweenY.set(target.y), tweenZoom.set(target.zoom)]);
viewer.releaseResolution();
viewer.resumeLoading();
```

## Development

Run each of these from the project root:

- `npm run dev`: demo site at `src/routes`.
- `npm run storybook`: component stories.
- `npm test`: unit tests in Node, then the stories in a headless Chromium browser (needs `npx playwright install chromium`).
- `npm run check`: type check with `svelte-check`.
- `npm run lint` / `npm run format`: Prettier and ESLint.
- `npm run build`: builds the static demo site into `build/`, then the package into `dist/`, including the vanilla bundle. Set `BASE_PATH` (for example `BASE_PATH=/dzi-viewer`) when the site will be hosted under a sub-path.

## Contributing

This project was created with AI. Forks are welcome, but pull requests are only accepted in exceptional circumstances. You are welcome to open a [GitHub issue](https://github.com/AshKyd/dzi-viewer/issues), though it may not be actioned.

This software is provided as-is, with no warranty or liability of any kind. See [LICENSE](./LICENSE) for the full ISC licence text.

## Credits

Inspired by [OpenSeadragon](https://openseadragon.github.io/). `dzi-viewer` was built from scratch as a smaller, faster DOM-based alternative for modern browsers, using standard `<img>` elements and GPU-composited CSS transforms instead of `<canvas>` or WebGL.
