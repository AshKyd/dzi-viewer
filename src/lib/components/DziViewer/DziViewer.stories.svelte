<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { BEACH_DZI, CANAL_DZI, HARBOUR_DZI, PARK_DZI } from '../../../stories/exampleImages.js';
	import DziViewerDemo from './DziViewerDemo.svelte';

	const { Story } = defineMeta({
		title: 'DziViewer/Viewer',
		component: DziViewerDemo,
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
			maxDpr: 1.5,
			tileFadeDuration: 200
		}
	});
</script>

<Story
	name="Canal Fit and Tween"
	args={{
		source: CANAL_DZI,
		initialMode: 'fit'
	}}
/>

<Story
	name="Harbour Fill Screen"
	args={{
		source: HARBOUR_DZI,
		initialMode: 'fill'
	}}
/>

<Story
	name="Beach Zoomed In (8160px)"
	args={{
		source: BEACH_DZI,
		initialMode: 'fit',
		panX: 0.3,
		panY: 0.5,
		zoomFactor: 6
	}}
/>

<Story
	name="Custom Virtual Stage 1000x1000"
	args={{
		source: PARK_DZI,
		stageSize: { width: 1000, height: 1000 },
		initialMode: 'fit'
	}}
/>
