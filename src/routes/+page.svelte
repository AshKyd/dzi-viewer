<script lang="ts">
	import OpenSeahorseDemo from '#lib/components/OpenSeahorse/OpenSeahorseDemo.svelte';

	const VENICE_DZI = '/dzi/kithandkinhero.dzi';
</script>

<main>
	<h1>OpenSeahorse</h1>
	<OpenSeahorseDemo source={VENICE_DZI} />
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
