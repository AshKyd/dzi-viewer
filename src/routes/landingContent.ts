// Landing page content. The code samples live here, not in `+page.svelte`, because a closing script tag
// inside a `<script>` block would end it early.

export const GITHUB_URL = 'https://github.com/AshKyd/dzi-viewer';

export const INSTALL_COMMAND = 'npm install dzi-viewer';

export const SVELTE_EXAMPLE = `<script lang="ts">
	import { PanZoom } from 'dzi-viewer';
</script>

<div style="width: 100%; height: 600px">
	<PanZoom source="/images/photo.dzi" initialView="fit" alt="Harbour at dusk" />
</div>`;

export const VANILLA_EXAMPLE = `import { createPanZoom } from 'dzi-viewer/vanilla';

const viewer = createPanZoom(document.querySelector('#viewer'), {
	source: '/images/photo.dzi',
	initialView: 'fit',
	alt: 'Harbour at dusk'
});

viewer.setViewport({ zoom: 2 });`;
