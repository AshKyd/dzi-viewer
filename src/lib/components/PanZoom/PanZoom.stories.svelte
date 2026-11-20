<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { CANAL_DZI, PARK_DZI } from '../../../stories/exampleImages.js';
	import PanZoomDemo from './PanZoomDemo.svelte';

	const { Story } = defineMeta({
		title: 'DziViewer/PanZoom',
		component: PanZoomDemo,
		tags: ['autodocs'],
		argTypes: {
			panX: {
				control: { type: 'range', min: 0, max: 1, step: 0.01 }
			},
			panY: {
				control: { type: 'range', min: 0, max: 1, step: 0.01 }
			},
			zoomFactor: {
				control: { type: 'range', min: 0.5, max: 16, step: 0.1 }
			},
			wheelZoomFactor: {
				control: { type: 'range', min: 1.05, max: 2, step: 0.05 }
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
			disabled: false,
			panEnabled: true,
			zoomEnabled: true,
			wheelZoomFactor: 1.2,
			maxDpr: 1.5,
			tileFadeDuration: 200,
			constrainToBounds: false
		}
	});
</script>

<Story
	name="Lakeside Park Interactive (8160px)"
	args={{
		source: PARK_DZI,
		initialMode: 'fit'
	}}
/>

<Story
	name="Canal Constrained"
	args={{
		source: CANAL_DZI,
		initialMode: 'fill',
		constrainToBounds: true
	}}
/>
