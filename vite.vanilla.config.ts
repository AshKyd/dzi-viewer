import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * Builds the standalone, framework-agnostic `dzi-viewer/vanilla` ESM entry point.
 * Bundles the minimal Svelte 5 client runtime and injects component CSS automatically
 * so non-Svelte projects (React, Vue, plain JS) require zero Svelte compiler plugins.
 */
export default defineConfig({
	plugins: [
		svelte({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				css: 'injected'
			}
		})
	],
	build: {
		outDir: path.resolve(import.meta.dirname, 'dist/vanilla'),
		emptyOutDir: false,
		minify: true,
		lib: {
			entry: path.resolve(import.meta.dirname, 'src/lib/vanilla/index.ts'),
			formats: ['es'],
			fileName: () => 'index.js'
		}
	}
});
