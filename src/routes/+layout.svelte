<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<style>
	:global(:root) {
		--app-mono: 'Cascadia Code', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
	}

	:global(*) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		padding: 0;
		font-family: var(--app-mono);
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
	}

	:global(::-webkit-scrollbar) {
		width: 12px;
		height: 12px;
	}

	:global(::-webkit-scrollbar-track) {
		background: #f1f1f1;
	}

	:global(::-webkit-scrollbar-thumb) {
		background: #888888;
		border: 2px solid #f1f1f1;
	}

	:global(::-webkit-scrollbar-thumb:hover) {
		background: #555555;
	}
</style>
