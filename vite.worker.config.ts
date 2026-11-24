import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * Rebuilds `dist/tileEngineWorkerFactory.js` with the `TileEngine` worker inlined as a blob URL.
 * Runs after `svelte-package` (which leaves a Vite-only `?worker&inline` import in that file) so
 * the published package has no bundler-specific imports.
 */
export default defineConfig({
	build: {
		outDir: path.resolve(import.meta.dirname, 'dist'),
		emptyOutDir: false,
		minify: true,
		lib: {
			entry: path.resolve(import.meta.dirname, 'src/lib/tileEngineWorkerFactory.ts'),
			formats: ['es'],
			fileName: () => 'tileEngineWorkerFactory.js'
		}
	}
});
