<!-- src/lib/components/Sidebar.svelte -->
<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { signOut } from '@auth/sveltekit/client';
	import ArvayaLogo from '$lib/assets/ArvayaLogo.png';
	import { isOpsAllowed } from '$lib/services/ops-access';

	interface Props {
		isOpen?: boolean;
		session?: any;
	}

	let { isOpen = $bindable(true), session }: Props = $props();

	let showOpsLink = $derived(isOpsAllowed(session?.user?.email));

	// Main navigation
	const mainNavItems = [
		{ href: '/moe', label: 'Billi', description: 'AI Assistant', icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z', primary: true },
		{ href: '/spectra-job', label: 'Spectra RAG', description: 'Recruitment Search', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
	];

	// Legacy tools section
	const legacyNavItems = [
		{ href: '/appointments', label: 'Calendar', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
		{ href: '/billi', label: 'Time Entry', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
	];

	function isActive(href: string): boolean {
		return page.url.pathname === href;
	}

	function handleNavigate(href: string) {
		goto(href);
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
		class="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden animate-fade-in"
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
	class="fixed top-0 left-0 h-full w-72 glass-sidebar
	       shadow-2xl transform transition-transform duration-300 ease-in-out z-50
	       {isOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0"
>
	<div class="flex flex-col h-full">
		<!-- Header with Logo -->
		<div class="p-6 border-b border-white/[0.06]">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<img src={ArvayaLogo} alt="Arvaya" class="h-10 w-auto" />
				</div>
				<button
					onclick={() => (isOpen = false)}
					class="lg:hidden p-2 text-slate-400 hover:text-white hover:bg-white/[0.04] rounded-lg transition-colors btn-press"
					aria-label="Close sidebar"
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
					</svg>
				</button>
			</div>
			<div class="mt-3">
				<p class="text-xs font-semibold text-amber-500 uppercase tracking-wider">Developer Portal</p>
			</div>
		</div>

		<!-- Main Navigation -->
		<nav class="flex-1 overflow-y-auto px-4 py-6">
			<!-- AI Tools Section -->
			<div class="mb-8">
				<p class="px-3 mb-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">AI Tools</p>
				<ul class="space-y-1">
					{#each mainNavItems as item}
						<li>
							<button
								onclick={() => handleNavigate(item.href)}
								class="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all duration-200 btn-press
								       {isActive(item.href)
										? 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-400 shadow-lg shadow-amber-500/10 border border-amber-500/20'
										: item.primary
											? 'text-slate-200 hover:bg-white/[0.04] hover:text-amber-400'
											: 'text-slate-300 hover:bg-white/[0.04] hover:text-white'}"
							>
								<div class="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center relative
								            {isActive(item.href)
											? 'bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/30'
											: item.primary
												? 'bg-gradient-to-br from-amber-500/20 to-orange-600/20 text-amber-400'
												: 'bg-white/[0.04] text-slate-400'}">
									<svg class="w-5 h-5 {isActive(item.href) ? 'text-white' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={item.icon}></path>
									</svg>
									{#if isActive(item.href)}
										<span class="absolute -right-1 -top-1 w-2.5 h-2.5 rounded-full bg-amber-400 animate-glow-pulse"></span>
									{/if}
								</div>
								<div>
									<p class="font-medium">{item.label}</p>
									{#if item.description}
										<p class="text-xs {isActive(item.href) ? 'text-amber-400/70' : 'text-slate-500'}">{item.description}</p>
									{/if}
								</div>
							</button>
						</li>
					{/each}
				</ul>
			</div>

			<!-- Legacy Tools Section -->
			<div>
				<p class="px-3 mb-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Individual Tools</p>
				<ul class="space-y-1">
					{#each legacyNavItems as item}
						<li>
							<button
								onclick={() => handleNavigate(item.href)}
								class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-200 btn-press
								       {isActive(item.href)
										? 'bg-white/[0.06] text-white'
										: 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'}"
							>
								<div class="relative">
									<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={item.icon}></path>
									</svg>
									{#if isActive(item.href)}
										<span class="absolute -right-1.5 -top-1.5 w-2 h-2 rounded-full bg-amber-400 animate-glow-pulse"></span>
									{/if}
								</div>
								<span class="text-sm">{item.label}</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>

			<!-- Ops Section (restricted) -->
			{#if showOpsLink}
				<div class="mt-8">
					<p class="px-3 mb-3 text-xs font-semibold text-violet-400/70 uppercase tracking-wider">Operations</p>
					<ul class="space-y-1">
						<li>
							<button
								onclick={() => handleNavigate('/ops')}
								class="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all duration-200 btn-press
								       {isActive('/ops')
										? 'bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 text-violet-300 shadow-lg shadow-violet-500/10 border border-violet-500/20'
										: 'text-slate-300 hover:bg-white/[0.04] hover:text-violet-300'}"
							>
								<div class="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center relative
								            {isActive('/ops')
											? 'bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-500/30'
											: 'bg-gradient-to-br from-violet-500/20 to-fuchsia-600/20 text-violet-400'}">
									<svg class="w-5 h-5 {isActive('/ops') ? 'text-white' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"></path>
									</svg>
									{#if isActive('/ops')}
										<span class="absolute -right-1 -top-1 w-2.5 h-2.5 rounded-full bg-violet-400 animate-glow-pulse"></span>
									{/if}
								</div>
								<div>
									<p class="font-medium">Ops Center</p>
									<p class="text-xs {isActive('/ops') ? 'text-violet-400/70' : 'text-slate-500'}">Platform Intelligence</p>
								</div>
							</button>
						</li>
					</ul>
				</div>
			{/if}
		</nav>

		<!-- User Section -->
		<div class="p-4 border-t border-white/[0.06] bg-white/[0.02]">
			{#if session?.user}
				<div class="flex items-center gap-3 mb-3">
					<div class="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-semibold shadow-lg shadow-amber-500/20">
						{(session.user.name || session.user.email || 'U').charAt(0).toUpperCase()}
					</div>
					<div class="flex-1 min-w-0">
						<p class="text-sm font-medium text-white truncate">
							{session.user.name || 'User'}
						</p>
						<p class="text-xs text-slate-400 truncate">
							{session.user.email || ''}
						</p>
					</div>
				</div>
				<button
					onclick={() => signOut()}
					class="w-full px-4 py-2 text-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 btn-press"
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
					</svg>
					Sign Out
				</button>
			{/if}
		</div>
	</div>
</aside>
