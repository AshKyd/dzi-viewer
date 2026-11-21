<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import CameraDemo from './CameraDemo.svelte';
	import { HERENGRACHT_DZI, ROMA_STREET_PARKLANDS_DZI } from './exampleImages.js';

	const { Story } = defineMeta({
		title: 'DziViewer/Camera & Transitions',
		component: CameraDemo,
		tags: ['autodocs'],
		argTypes: {
			mode: {
				control: { type: 'inline-radio' },
				options: ['transitions', 'scrub']
			},
			curve: {
				control: { type: 'inline-radio' },
				options: ['direct', 'fly']
			},
			duration: {
				control: { type: 'range', min: 0, max: 2500, step: 100 }
			},
			rho: {
				control: { type: 'range', min: 0.5, max: 2.5, step: 0.05 }
			},
			loadDebounceMs: {
				control: { type: 'range', min: 0, max: 500, step: 25 }
			},
			settleDelayMs: {
				control: { type: 'range', min: 0, max: 500, step: 20 }
			},
			scrubPrecache: {
				control: { type: 'inline-radio' },
				options: ['to', 'both', false]
			}
		},
		args: {
			source: ROMA_STREET_PARKLANDS_DZI,
			mode: 'transitions',
			curve: 'direct',
			duration: 900,
			rho: 1.42,
			refitOnResize: true,
			loadDebounceMs: 150,
			settleDelayMs: 120,
			scrubPrecache: 'to',
			interactive: true
		}
	});
</script>

<Story
	name="Direct Transitions & PanZoom"
	args={{
		source: HERENGRACHT_DZI,
		mode: 'transitions',
		curve: 'direct',
		duration: 800
	}}
/>

<Story
	name="Fly Curve (van Wijk & Nuij)"
	args={{
		source: ROMA_STREET_PARKLANDS_DZI,
		mode: 'transitions',
		curve: 'fly',
		duration: 1200,
		rho: 1.42
	}}
/>

<Story
	name="Multi-Stop Track Scrubbing"
	args={{
		source: ROMA_STREET_PARKLANDS_DZI,
		mode: 'scrub',
		curve: 'fly',
		interactive: false,
		refitOnResize: true
	}}
/>
