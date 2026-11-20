<script lang="ts">
	import { asset } from '$app/paths';
	import { Button, Header, LayoutContentWidth, ReaderTypography, Tabs } from 'svelte-akui';
	import type { DziViewerMethods } from '#lib/components/DziViewer/dziViewerTypes.js';
	import PanZoom from '#lib/components/PanZoom/PanZoom.svelte';
	import type { DziDescriptor, Size } from '#lib/types.js';
	import {
		BARCELONA_HARBOUR_DZI,
		HERENGRACHT_DZI,
		NOOSA_BEACH_DZI,
		ROMA_STREET_PARKLANDS_DZI
	} from '../stories/exampleImages.js';
	import {
		GITHUB_URL,
		INSTALL_COMMAND,
		SVELTE_EXAMPLE,
		VANILLA_EXAMPLE
	} from './landingContent.js';

	const exampleImages = [
		{
			id: 'noosa-beach',
			label: 'Noosa',
			source: asset(NOOSA_BEACH_DZI),
			alt: 'Noosa Beach and town across the bay, with hills behind'
		},
		{
			id: 'roma-street-parklands',
			label: 'Roma St',
			source: asset(ROMA_STREET_PARKLANDS_DZI),
			alt: 'Roma Street Parklands in Brisbane: a lake, fountain and apartment towers'
		},
		{
			id: 'herengracht',
			label: 'Herengracht',
			source: asset(HERENGRACHT_DZI),
			alt: 'Herengracht in Amsterdam: a canal street with bikes and gabled houses'
		},
		{
			id: 'barcelona-harbour',
			label: 'Barcelona',
			source: asset(BARCELONA_HARBOUR_DZI),
			alt: 'Barcelona harbour from a hill, with cruise ships and warehouses'
		}
	];

	// Every tab shows the same viewer snippet, so switching tabs swaps the image without remounting it.
	const tabItems = exampleImages.map(({ id, label }) => ({ id, label, content: viewerPanel }));

	let activeId = $state(exampleImages[0].id);
	const activeImage = $derived(
		exampleImages.find((image) => image.id === activeId) ?? exampleImages[0]
	);

	let viewer: DziViewerMethods | undefined = $state();
	let x = $state(0);
	let y = $state(0);
	let zoom = $state(0.1);
	let dzi = $state<DziDescriptor | null>(null);
	let containerSize = $state<Size>({ width: 0, height: 0 });
	/** The last image framed in the viewer, so each newly loaded image is framed once. */
	let framedDzi: DziDescriptor | null = null;

	// Fill the viewer with each image once it has loaded and the container has a size, so it starts slightly
	// zoomed in with no empty bands at the edges.
	$effect(() => {
		if (!dzi || dzi === framedDzi || containerSize.width === 0) {
			return;
		}
		const fill = viewer?.getFillViewport();
		if (!fill) {
			return;
		}
		({ x, y, zoom } = fill);
		framedDzi = dzi;
	});
</script>

{#snippet viewerPanel()}
	<div class="viewer">
		<PanZoom
			bind:this={viewer}
			source={activeImage.source}
			alt={activeImage.alt}
			bind:x
			bind:y
			bind:zoom
			bind:dzi
			bind:containerSize
			cooperativeGestures
		/>
	</div>
{/snippet}

<svelte:head>
	<title>dzi-viewer: Deep Zoom image viewer for Svelte</title>
	<meta
		name="description"
		content="A small, DOM-based Deep Zoom (DZI) image viewer for Svelte 5 and plain JavaScript."
	/>
</svelte:head>

<Header>
	{#snippet title()}
		<strong>dzi-viewer</strong>
	{/snippet}
	{#snippet actions()}
		<Button href={GITHUB_URL} variant="ghost" label="GitHub" />
	{/snippet}
</Header>

<main>
	<LayoutContentWidth size="large">
		<ReaderTypography>
			<h1>dzi-viewer</h1>
			<p>
				A Deep Zoom (DZI) image viewer for Svelte 5. It loads only the tiles you can see, at the
				right resolution for the screen, and keeps lower-resolution tiles showing underneath while
				sharper ones load.
			</p>
		</ReaderTypography>

		<section class="preview" aria-label="Example images">
			<Tabs items={tabItems} bind:activeId />
			<p class="hint">
				Drag or use two fingers to pan. Ctrl/⌘ + scroll, pinch or double-click to zoom.
			</p>
		</section>

		<ReaderTypography>
			<ul>
				<li><code>DziViewer</code> shows a DZI image at a given position and zoom.</li>
				<li>
					<code>PanZoom</code> wraps <code>DziViewer</code> and adds drag, wheel, pinch, double-click
					and keyboard controls.
				</li>
				<li>
					<code>dzi-viewer/vanilla</code> mounts either viewer in any page, without Svelte.
				</li>
			</ul>

			<h2>Install</h2>
			<pre><code>{INSTALL_COMMAND}</code></pre>

			<h2>Svelte</h2>
			<pre><code>{SVELTE_EXAMPLE}</code></pre>

			<h2>Vanilla JavaScript</h2>
			<pre><code>{VANILLA_EXAMPLE}</code></pre>

			<p>
				Props, methods, pausing downloads and holding the resolution are covered in the
				<a href="https://github.com/AshKyd/dzi-viewer#readme">README on GitHub</a>.
			</p>
		</ReaderTypography>
	</LayoutContentWidth>
</main>

<style>
	/* `LayoutContentWidth` only caps the width, so the page supplies its own side gutters. */
	main {
		padding: 1rem 1rem 3rem;
	}

	.preview {
		display: grid;
		gap: 0.5rem;
		margin-block: 1.5rem;
	}

	/* Shorter tabs so all four fit on a phone. */
	.preview :global(.akui-tab) {
		min-width: 0;
		padding-inline: 0.75rem;
	}

	/* The viewer fills the tab panel edge to edge, clipped to its rounded corners. */
	.preview :global(.akui-tabs-content) {
		/* 1px at the top so the image doesn't butt up against the tabs. */
		padding: 1px 0 0;
		overflow: hidden;
	}

	.viewer {
		height: min(70vh, 640px);
		min-height: 320px;
		background: var(--akui-bg-secondary);
	}

	.hint {
		margin: 0;
		font-size: 0.875rem;
		opacity: 0.75;
	}
</style>
