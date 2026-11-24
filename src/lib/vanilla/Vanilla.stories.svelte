<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { NOOSA_BEACH_DZI, BARCELONA_HARBOUR_DZI } from '../../stories/exampleImages.js';
	import VanillaDemo from './VanillaDemo.svelte';

	const { Story } = defineMeta({
		title: 'DziViewer/Vanilla Non-Svelte API',
		component: VanillaDemo,
		tags: ['autodocs'],
		argTypes: {
			mode: {
				control: { type: 'inline-radio' },
				options: ['panzoom', 'viewer']
			},
			panX: {
				control: { type: 'range', min: 0, max: 1, step: 0.01 }
			},
			panY: {
				control: { type: 'range', min: 0, max: 1, step: 0.01 }
			},
			zoomFactor: {
				control: { type: 'range', min: 0.5, max: 16, step: 0.1 }
			},
			maxDpr: {
				control: { type: 'range', min: 0.5, max: 3, step: 0.25 }
			},
			tileFadeDuration: {
				control: { type: 'range', min: 0, max: 1500, step: 50 }
			},
			initialMode: {
				control: { type: 'inline-radio' },
				options: ['fit', 'fill']
			}
		},
		args: {
			panX: 0.5,
			panY: 0.5,
			zoomFactor: 1,
			maxDpr: 1,
			tileFadeDuration: 200,
			debug: false,
			disabled: false,
			panEnabled: true,
			zoomEnabled: true
		}
	});
</script>

<Story
	name="Vanilla PanZoom"
	args={{
		mode: 'panzoom',
		source: BARCELONA_HARBOUR_DZI,
		initialMode: 'fit'
	}}
/>

<Story
	name="Vanilla DziViewer"
	args={{
		mode: 'viewer',
		source: NOOSA_BEACH_DZI,
		initialMode: 'fill'
	}}
/>
