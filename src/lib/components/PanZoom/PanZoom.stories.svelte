<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { HERENGRACHT_DZI, ROMA_STREET_PARKLANDS_DZI } from '../../../stories/exampleImages.js';
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
			maxTileMountsPerFrame: {
				control: { type: 'range', min: 1, max: 64, step: 1 }
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
			maxTileMountsPerFrame: 8,
			constrainToBounds: false,
			cooperativeGestures: false,
			pauseWhileInteracting: true,
			holdResolutionWhileInteracting: true
		}
	});
</script>

<Story
	name="Roma Street Parklands Interactive (8160px)"
	args={{
		source: ROMA_STREET_PARKLANDS_DZI,
		initialMode: 'fit'
	}}
/>

<Story
	name="Herengracht Constrained"
	args={{
		source: HERENGRACHT_DZI,
		initialMode: 'fill',
		constrainToBounds: true
	}}
/>
