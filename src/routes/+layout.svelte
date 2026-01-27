<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: any; data: LayoutData } = $props();

	let sidebarOpen = $state(false);
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="flex min-h-screen mesh-gradient-subtle dot-pattern">
	<Sidebar bind:isOpen={sidebarOpen} session={data.session} />

	<!-- Main Content -->
	<main class="flex-1 lg:ml-72">
		<!-- Mobile menu button -->
		<button
			onclick={() => (sidebarOpen = true)}
			class="lg:hidden fixed top-4 left-4 z-30 p-2 glass rounded-lg text-slate-300 hover:text-white btn-press transition-colors"
			aria-label="Open menu"
		>
			<svg
				class="w-6 h-6"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M4 6h16M4 12h16M4 18h16"
				></path>
			</svg>
		</button>

		{@render children()}
	</main>
</div>
