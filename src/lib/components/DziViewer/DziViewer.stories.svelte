<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import DziViewerDemo from './DziViewerDemo.svelte';

	const VENICE_DZI = '/dzi/kithandkinhero.dzi';
	const ABC_SCAM_DZI = '/dzi/fake-abc-sites2.dzi';

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
	name="Venice Fit and Tween"
	args={{
		source: VENICE_DZI,
		initialMode: 'fit'
	}}
/>

<Story
	name="ABC Scam Sites Fill Screen"
	args={{
		source: ABC_SCAM_DZI,
		initialMode: 'fill'
	}}
/>

<Story
	name="Custom Virtual Stage 1000x1000"
	args={{
		source: VENICE_DZI,
		stageSize: { width: 1000, height: 1000 },
		initialMode: 'fit'
	}}
/>
