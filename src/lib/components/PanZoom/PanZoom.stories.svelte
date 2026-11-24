<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';
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
			maxDpr: 1,
			tileFadeDuration: 200,
			debug: false,
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
	name="Herengracht Gestures"
	args={{
		source: HERENGRACHT_DZI,
		initialMode: 'fit'
	}}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const status = () => {
			const text = canvas.getByText(/zoom \d/).textContent ?? '';
			const [, x, y, zoom] = text.match(/x (-?\d+), y (-?\d+) \| zoom ([\d.]+)/) ?? [];
			return { x: Number(x), y: Number(y), zoom: Number(zoom) };
		};
		await waitFor(() => expect(canvas.getByText(/Optimal loaded/)).toBeInTheDocument(), {
			timeout: 15_000
		});

		const viewer = canvas.getByRole('application');
		const rect = viewer.getBoundingClientRect();
		const centre = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
		const mouse = { pointerId: 1, pointerType: 'mouse', isPrimary: true };

		// Dragging right moves the image right, so the viewport centre moves left.
		const beforeDrag = status();
		await fireEvent.pointerDown(viewer, { ...mouse, ...centre, button: 0, buttons: 1 });
		await fireEvent.pointerMove(viewer, {
			...mouse,
			clientX: centre.clientX + 60,
			clientY: centre.clientY,
			buttons: 1
		});
		await fireEvent.pointerMove(viewer, {
			...mouse,
			clientX: centre.clientX + 120,
			clientY: centre.clientY,
			buttons: 1
		});
		await fireEvent.pointerUp(viewer, { ...mouse, clientX: centre.clientX + 120, button: 0 });
		await waitFor(() => expect(status().x).toBeLessThan(beforeDrag.x - 50));

		// Scrolling up zooms in.
		const beforeWheel = status();
		await fireEvent.wheel(viewer, { ...centre, deltaY: -100 });
		await waitFor(() => expect(status().zoom).toBeGreaterThan(beforeWheel.zoom));

		// Arrow keys pan and +/- zoom when focused.
		viewer.focus();
		const beforeKeys = status();
		await userEvent.keyboard('{ArrowLeft}');
		await waitFor(() => expect(status().x).toBeLessThan(beforeKeys.x));
		await userEvent.keyboard('-');
		await waitFor(() => expect(status().zoom).toBeLessThan(beforeKeys.zoom));
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
