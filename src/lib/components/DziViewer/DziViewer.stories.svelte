<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import {
		NOOSA_BEACH_DZI,
		HERENGRACHT_DZI,
		BARCELONA_HARBOUR_DZI,
		ROMA_STREET_PARKLANDS_DZI
	} from '../../../stories/exampleImages.js';
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
			maxDpr: 1.5,
			tileFadeDuration: 200,
			maxTileMountsPerFrame: 8,
			pauseWhileAnimating: true,
			holdResolutionWhileAnimating: true
		}
	});
</script>

<Story
	name="Herengracht Fit and Tween"
	args={{
		source: HERENGRACHT_DZI,
		initialMode: 'fit'
	}}
/>

<Story
	name="Barcelona Harbour Fill Screen"
	args={{
		source: BARCELONA_HARBOUR_DZI,
		initialMode: 'fill'
	}}
/>

<Story
	name="Noosa Beach Zoomed In (8160px)"
	args={{
		source: NOOSA_BEACH_DZI,
		initialMode: 'fit',
		panX: 0.3,
		panY: 0.5,
		zoomFactor: 6
	}}
/>

<Story
	name="Roma Street Parklands on a 1000x1000 Stage"
	args={{
		source: ROMA_STREET_PARKLANDS_DZI,
		stageSize: { width: 1000, height: 1000 },
		initialMode: 'fit'
	}}
/>
