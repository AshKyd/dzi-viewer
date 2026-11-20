<script lang="ts">
	import DziViewerDemo from '#lib/components/DziViewer/DziViewerDemo.svelte';

	const VENICE_DZI = '/dzi/kithandkinhero.dzi';
</script>

<main>
	<h1>dzi-viewer</h1>
	<DziViewerDemo source={VENICE_DZI} />
</main>

<style>
	main {
		max-width: 1100px;
		margin: 0 auto;
		padding: 1.5rem;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
	}
</style>
