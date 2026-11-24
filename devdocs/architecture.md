# Architecture

How a viewport change turns into pixels, top to bottom.

## Layers

- `PanZoom` (`components/PanZoom/`): user input. `createGestureController` (drag, pinch, wheel via `@use-gesture/vanilla`), keyboard and double-click turn into new `x`, `y`, `zoom` values. Viewport maths lives in `panZoomUtils.ts`.
- `DziViewer` (`components/DziViewer/`): loads the descriptor with `loadDzi`, measures the container, applies `initialView`, and pushes state to one `CanvasTileRenderer`.
- `createViewerMethodProxy`: gives `PanZoom` and the vanilla controllers the same `DziViewerMethods` as the inner `DziViewer`.
- `CanvasTileRenderer` (`canvasRenderer.ts`): main thread. Stages changes in `#pendingSync`, sends them to the engine once per frame, uploads bitmaps within a time budget and draws each frame on a `RenderSurface`.
- `RenderSurface` (`renderSurface.ts`): WebGL2 via `rapid-render`, or a 2D canvas fallback.
- `TileEngineClient` (`tileEngineClient.ts`): a `TileEngine` in a worker (`WorkerTileEngineClient`, via Comlink), or the `TileEngine` itself in-process.
- `TileEngine` (`tileEngine.ts`): picks tiles (`tiling.ts`), keeps fallbacks (`retention.ts`), caches (`TileCache`) and loads (`TileLoader`). Sends back `TileEngineDelta`s.

## Why the engine runs in a worker

- Tile selection, fallback planning and image decoding are slow enough to drop frames on the main thread.
- The engine runs in-process instead when `getTileUrl` or `loadImage` is a custom function (functions can't be sent to a worker), when `Worker` is missing, or when CSP blocks the inline worker.

## Supporting modules

- `dziParse.ts`: `.dzi` XML/JSON to `DziDescriptor`. XML uses the native `DOMParser`; unit tests install `@xmldom/xmldom` (`src/test/setupDomParser.ts`).
- `pyramid.ts`: level sizes, tile grids and tile rectangles.
- `viewport.ts`: fit/fill, clamping and stage ↔ screen conversion.
- `transition.ts` and `camera.ts`: interpolation and `createCamera` (timed `goTo`, scroll `scrub`). Small helpers are in `cameraUtils.ts`.
- `canvasGeometry.ts`: canvas backing size and tile draw rectangles.
- `tileFade.ts`: `TileFadeTracker`, tile fade-in and opacity.
- `lifecycleEmitter.ts`: `subscribe()` events (`load`, `resize`, `source-change`, `interact`, `destroy`).

## Public API

- `core.ts` lists everything exported from both `dzi-viewer` and `dzi-viewer/vanilla`.
- Tile loading, caching and painting classes are internal. Add to `core.ts` only what a consumer needs.
