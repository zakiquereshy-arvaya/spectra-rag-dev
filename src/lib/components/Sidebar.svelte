<!-- src/lib/components/Sidebar.svelte -->
<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { signOut } from '@auth/sveltekit/client';

	interface Props {
		isOpen?: boolean;
		session?: any;
	}

	let { isOpen = $bindable(true), session }: Props = $props();

	const navItems = [
		{ href: '/', label: 'Home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
		{ href: '/spectra-job', label: 'Spectra Project Assistant', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
		{ href: '/appointments', label: 'Appointments', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
		// ADD HREF FOR BILLI WHEN YOU INTEGRATE IT HERE.
	];

	function isActive(href: string): boolean {
		return page.url.pathname === href;
	}

	function handleNavigate(href: string) {
		goto(href);
		// Close sidebar on mobile after navigation
		if (typeof window !== 'undefined' && window.innerWidth < 1024) {
			isOpen = false;
		}
	}
</script>

<!-- Overlay for mobile -->
{#if isOpen}
	<div
		role="button"
		tabindex="0"
		class="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden transition-opacity"
		onclick={() => (isOpen = false)}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				isOpen = false;
			}
		}}
		aria-label="Close sidebar"
	></div>
{/if}

<!-- Sidebar -->
<aside
	class="fixed top-0 left-0 h-full w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 
	       transform transition-transform duration-300 ease-in-out z-50
	       {isOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0"
>
	<div class="flex flex-col h-full">
		<!-- Sidebar Header -->
		<div class="p-6 border-b border-gray-200 dark:border-gray-800">
			<div class="flex items-center justify-between">
				<h2 class="text-xl font-bold text-gray-900 dark:text-white">Arvaya AI & Automations Consulting</h2>
				<button
					onclick={() => (isOpen = false)}
					class="lg:hidden text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
					aria-label="Close sidebar"
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
							d="M6 18L18 6M6 6l12 12"
						></path>
					</svg>
				</button>
			</div>
			<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Zaki Dev Portal</p>
		</div>

		<!-- Navigation -->
		<nav class="flex-1 overflow-y-auto p-4">
			<ul class="space-y-2">
				{#each navItems as item}
					<li>
						<button
							onclick={() => handleNavigate(item.href)}
							class="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors
							       {isActive(item.href)
									? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium'
									: 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}"
						>
							<svg
								class="w-5 h-5"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d={item.icon}
								></path>
							</svg>
							<span>{item.label}</span>
						</button>
					</li>
				{/each}
			</ul>
		</nav>

		<!-- Footer -->
		<div class="p-4 border-t border-gray-200 dark:border-gray-800">
			{#if session?.user}
				<div class="mb-3">
					<p class="text-sm text-gray-700 dark:text-gray-300 font-medium mb-1">
						{session.user.name || session.user.email}
					</p>
					<button
						onclick={() => signOut()}
						class="w-full px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
					>
						Sign Out
					</button>
				</div>
			{/if}
			<p class="text-xs text-gray-500 dark:text-gray-400 text-center">
				© 2026 Arvaya AI & Automations Consulting 
			</p>
		</div>
	</div>
</aside>
