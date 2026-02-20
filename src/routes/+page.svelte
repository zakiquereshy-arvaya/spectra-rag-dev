<!-- src/routes/+page.svelte - Arvaya Developer Portal -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { signIn } from '@auth/sveltekit/client';
	import ArvayaLogo from '$lib/assets/ArvayaLogo.png';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let isSigningIn = $state(false);

	async function handleSignIn() {
		if (isSigningIn) return;
		isSigningIn = true;
		try {
			await signIn('microsoft-entra-id');
		} catch (error) {
			console.error('Sign-in initiation failed:', error);
			isSigningIn = false;
		}
	}

	const tools = [
		{
			name: 'Billi',
			description: 'Unified AI assistant for calendar management and time tracking',
			href: '/moe',
			icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
			gradient: 'from-amber-500 to-orange-600',
			bgGradient: 'from-amber-500/10 to-orange-500/10',
			primary: true,
		},
		{
			name: 'Spectra RAG',
			description: 'AI-powered recruitment search across all platforms',
			href: '/spectra-job',
			icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
			gradient: 'from-violet-500 to-purple-600',
			bgGradient: 'from-violet-500/10 to-purple-500/10',
		},
		{
			name: 'Calendar',
			description: 'Book meetings and check availability',
			href: '/appointments',
			icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
			gradient: 'from-sky-500 to-blue-600',
			bgGradient: 'from-sky-500/10 to-blue-500/10',
		},
		{
			name: 'Time Entry',
			description: 'Log hours to QuickBooks and Monday.com',
			href: '/billi',
			icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
			gradient: 'from-emerald-500 to-teal-600',
			bgGradient: 'from-emerald-500/10 to-teal-500/10',
		},
	];
</script>

<div class="min-h-screen">
	<!-- Hero Section -->
	<section class="relative overflow-hidden">
		<!-- Background Pattern -->
		<div class="absolute inset-0 mesh-gradient"></div>
		<div class="absolute inset-0 dot-pattern"></div>

		<div class="relative px-6 py-20 lg:py-32">
			<div class="max-w-5xl mx-auto">
				{#if !data.session}
					<!-- Login State -->
					<div class="text-center">
						<div class="flex justify-center mb-8 animate-fade-in-up">
							<img src={ArvayaLogo} alt="Arvaya" class="h-16 md:h-20" />
						</div>
						<h1 class="text-4xl lg:text-6xl font-bold text-white mb-6 animate-fade-in-up" style="animation-delay: 0.1s">
							Developer Portal
						</h1>
						<p class="text-lg text-slate-400 mb-10 max-w-xl mx-auto animate-fade-in-up" style="animation-delay: 0.2s">
							Internal tools and AI assistants for the Arvaya team
						</p>
						<button
							onclick={handleSignIn}
							disabled={isSigningIn}
							class="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl font-semibold text-lg
							       hover:from-amber-400 hover:to-orange-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-surface
							       transition-all duration-200 shadow-lg shadow-amber-500/25 hover:shadow-xl hover:shadow-amber-500/30 btn-press btn-glow animate-fade-in-up
							       disabled:opacity-70 disabled:cursor-not-allowed"
							style="animation-delay: 0.3s"
						>
							<svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
								<path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z"/>
							</svg>
							{isSigningIn ? 'Signing in...' : 'Sign in with Microsoft'}
						</button>
					</div>
				{:else}
					<!-- Authenticated State -->
					<div class="text-center mb-16">
						<div class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm font-medium mb-6 animate-fade-in-up">
							<span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
							Welcome back, {data.session.user?.name?.split(' ')[0] || 'Developer'}
						</div>
						<h1 class="text-4xl lg:text-5xl font-bold text-white mb-4 animate-fade-in-up" style="animation-delay: 0.1s">
							Arvaya Developer Portal
						</h1>
						<p class="text-lg text-slate-400 max-w-2xl mx-auto animate-fade-in-up" style="animation-delay: 0.2s">
							Your hub for AI-powered tools and automation. Select a tool below to get started.
						</p>
					</div>

					<!-- Tools Grid -->
					<div class="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
						{#each tools as tool, i}
							<button
								onclick={() => goto(tool.href)}
								class="group relative p-6 rounded-2xl glass card-hover
								       text-left animate-fade-in-up
								       {tool.primary ? 'md:col-span-2' : ''}"
								style="animation-delay: {0.3 + i * 0.1}s"
							>
								<!-- Hover gradient overlay -->
								<div class="absolute inset-0 rounded-2xl bg-gradient-to-br {tool.bgGradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

								<div class="relative flex items-start gap-4">
									<!-- Icon -->
									<div class="flex-shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br {tool.gradient} flex items-center justify-center shadow-lg group-hover:shadow-xl transition-shadow">
										<svg class="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={tool.icon}></path>
										</svg>
									</div>

									<!-- Content -->
									<div class="flex-1">
										<div class="flex items-center gap-2 mb-1">
											<h3 class="text-xl font-semibold text-white group-hover:text-amber-400 transition-colors">
												{tool.name}
											</h3>
											{#if tool.primary}
												<span class="px-2 py-0.5 text-xs font-medium bg-amber-500/20 text-amber-400 rounded-full">
													Recommended
												</span>
											{/if}
										</div>
										<p class="text-slate-400 group-hover:text-slate-300 transition-colors">
											{tool.description}
										</p>
									</div>

									<!-- Arrow -->
									<div class="flex-shrink-0 w-10 h-10 rounded-full bg-white/[0.04] group-hover:bg-white/[0.08] flex items-center justify-center transition-colors">
										<svg class="w-5 h-5 text-slate-500 group-hover:text-white transition-colors transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
										</svg>
									</div>
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</section>

	{#if data.session}
		<!-- Quick Stats Section -->
		<section class="px-6 py-16 border-t border-white/[0.06]">
			<div class="max-w-4xl mx-auto">
				<h2 class="text-2xl font-bold text-white mb-8 text-center">Quick Actions</h2>
				<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
					<button
						onclick={() => goto('/moe')}
						class="p-4 rounded-xl glass card-hover group"
					>
						<div class="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center mb-3 group-hover:bg-amber-500/20 transition-colors">
							<svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
							</svg>
						</div>
						<p class="text-sm font-medium text-white">Chat with Billi</p>
						<p class="text-xs text-slate-500 mt-1">Ask anything</p>
					</button>

					<button
						onclick={() => goto('/moe')}
						class="p-4 rounded-xl glass card-hover group"
					>
						<div class="w-10 h-10 rounded-lg bg-sky-500/10 flex items-center justify-center mb-3 group-hover:bg-sky-500/20 transition-colors">
							<svg class="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
							</svg>
						</div>
						<p class="text-sm font-medium text-white">Check Calendar</p>
						<p class="text-xs text-slate-500 mt-1">View availability</p>
					</button>

					<button
						onclick={() => goto('/moe')}
						class="p-4 rounded-xl glass card-hover group"
					>
						<div class="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-3 group-hover:bg-emerald-500/20 transition-colors">
							<svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
							</svg>
						</div>
						<p class="text-sm font-medium text-white">Log Time</p>
						<p class="text-xs text-slate-500 mt-1">Track hours</p>
					</button>

					<button
						onclick={() => goto('/spectra-job')}
						class="p-4 rounded-xl glass card-hover group"
					>
						<div class="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center mb-3 group-hover:bg-violet-500/20 transition-colors">
							<svg class="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
							</svg>
						</div>
						<p class="text-sm font-medium text-white">Search Candidates</p>
						<p class="text-xs text-slate-500 mt-1">RAG search</p>
					</button>
				</div>
			</div>
		</section>
	{/if}

	<!-- Footer -->
	<footer class="px-6 py-8 border-t border-white/[0.06]">
		<div class="max-w-4xl mx-auto text-center">
			<p class="text-sm text-slate-500">
				Arvaya AI & Automations Consulting
			</p>
		</div>
	</footer>
</div>
