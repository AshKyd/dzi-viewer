/// <reference types="vitest/config" />
import path from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			}
		})
	],
	test: {
		projects: [
			// Plain logic tests (`*.test.ts`) run in Node; component behaviour is covered by the storybook project.
			{
				extends: true,
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.test.ts'],
					setupFiles: ['src/test/setupDomParser.ts']
				}
			},
			{
				extends: true,
				plugins: [
					storybookTest({
						configDir: path.resolve(import.meta.dirname, '.storybook')
					})
				],
				test: {
					name: 'storybook',
					browser: {
						enabled: true,
						headless: true,
						provider: playwright({}),
						instances: [{ browser: 'chromium' }]
					}
				}
			}
		]
	}
});
