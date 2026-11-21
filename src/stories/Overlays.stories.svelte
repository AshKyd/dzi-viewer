<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { BARCELONA_HARBOUR_DZI, HERENGRACHT_DZI } from './exampleImages.js';
	import OverlaysDemo from './OverlaysDemo.svelte';

	const { Story } = defineMeta({
		title: 'DziViewer/Overlays & Interactive Handles',
		component: OverlaysDemo,
		tags: ['autodocs'],
		argTypes: {
			variant: {
				control: { type: 'inline-radio' },
				options: ['interactive-crop', 'aligned-layer']
			},
			overlayOpacity: {
				control: { type: 'range', min: 0, max: 1, step: 0.05 }
			},
			loadDebounceMs: {
				control: { type: 'range', min: 0, max: 500, step: 25 }
			}
		},
		args: {
			source: BARCELONA_HARBOUR_DZI,
			variant: 'interactive-crop',
			overlayOpacity: 0.75,
			loadDebounceMs: 150
		}
	});
</script>

<Story
	name="Draggable Crop Box & Pins"
	args={{
		source: BARCELONA_HARBOUR_DZI,
		variant: 'interactive-crop'
	}}
/>

<Story
	name="Aligned Full-Image Overlay"
	args={{
		source: HERENGRACHT_DZI,
		variant: 'aligned-layer',
		overlayOpacity: 0.8
	}}
/>
