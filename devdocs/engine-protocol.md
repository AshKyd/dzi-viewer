# Engine protocol

How `CanvasTileRenderer` and `TileEngine` talk. Types are in `tileEngineProtocol.ts`.

## Main thread → engine

- `sync(frame: EngineFrameSync)`: only the fields that changed since the last sync: `config`, `source`, `imageBounds`, `container`, `viewport`, `opaqueKeys`, `clearOpaque`.
- `CanvasTileRenderer` collects changes in `#pendingSync` and sends at most one sync per frame. In worker mode it also sends in a microtask, so the worker has a full frame to reply before painting.
- A new `source` resets the engine, so older `imageBounds` and `clearOpaque` changes are dropped.
- `precacheViewport` / `precacheBounds`: resolve with a `PrecacheResult`. In a worker each call gets an id; `abortPrecache(id)` cancels it, because `AbortSignal` can't cross threads.
- `pauseLoading(reason)` / `resumeLoading(reason)`: loading resumes once every reason is resumed.
- `holdResolution()` / `releaseResolution()`: caps the pyramid level at the current one.

## Engine → main thread

- `TileEngineDelta`, sent only when something changed:
  - `addedTiles`: decoded `ImageBitmap`s, transferred (not copied) from the worker.
  - `evictKeys`, `clearAll`: tiles the painter must drop.
  - `layers`, `optimalUploadOrder`: what to draw, bottom to top, and which uploads come first.
  - `baseTile`: the single-tile preview drawn under everything in worker mode.
  - `isOptimalLoaded`, `tileErrors`.

## Bitmap ownership

- The engine hands each bitmap to the painter and keeps only tile metadata.
- WebGL: the painter closes a bitmap right after uploading it as a texture.
- 2D canvas: the painter keeps bitmaps until the engine evicts them.

## Opacity

- A tile counts as covering the tiles under it only once it is fully faded in.
- The painter reports newly opaque keys in the next sync (`opaqueKeys`); the engine then drops fallback tiles they cover.

## Worker transport

- `tileEngine.worker.ts` exposes a small API with Comlink; `WorkerTileEngineClient` wraps it.
- Values are deep-copied with `toCloneable` first: Svelte `$state` proxies can't be cloned, and `getTileUrl` is a function.
- `tileEngineWorkerFactory.ts` is rebuilt by `vite.worker.config.ts` so the published package inlines the worker.
