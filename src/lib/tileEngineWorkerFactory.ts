import InlineTileEngineWorker from './tileEngine.worker.js?worker&inline';

/**
 * Starts the `TileEngine` Web Worker.
 *
 * Kept in its own module because `?worker&inline` is a Vite-only import. `svelte-package` copies
 * imports verbatim, so consuming apps would get a query their bundler (or Vite's dependency
 * pre-bundler) can't load. `vite.worker.config.ts` rebuilds this file into `dist/` after
 * `svelte-package`, replacing it with a self-contained version that has the worker code inlined.
 */
export function createTileEngineWorker(): Worker {
	return new InlineTileEngineWorker();
}
