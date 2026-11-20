<script lang="ts">
	import type { Snippet } from 'svelte';
	import { UIRoot } from 'svelte-akui';

	let { children }: { children: Snippet } = $props();
</script>

<UIRoot>
	{@render children()}
</UIRoot>
