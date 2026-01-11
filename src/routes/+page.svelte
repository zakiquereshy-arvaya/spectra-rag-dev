<!-- src/routes/+page.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { signIn } from '@auth/sveltekit/client';
	import ArvayaLogo from '$lib/assets/ArvayaLogo.png';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<div class="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
	<!-- Hero Section -->
	<section class="px-6 py-20 lg:py-32">
		<div class="max-w-4xl mx-auto text-center">
			<!-- Company Logo -->
			<div class="flex justify-center mb-8">
				<img src={ArvayaLogo} alt="Arvaya Logo" class="h-16 md:h-20" />
			</div>
			
			{#if !data.session}
				<!-- Login Section -->
				<h1 class="text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white mb-6">
					Welcome to
					<span class="text-blue-600 dark:text-blue-400">Arvaya's AI Project Development Portal</span>
				</h1>
				<p class="text-xl text-gray-600 dark:text-gray-300 mb-8 max-w-2xl mx-auto">
					Please sign in with your Microsoft account to continue.
				</p>
				<div class="flex justify-center">
					<button
						onclick={() => signIn('microsoft-entra-id')}
						class="px-8 py-4 bg-blue-600 text-white rounded-lg font-semibold text-lg
						       hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
						       transition-colors shadow-lg hover:shadow-xl"
					>
						Sign in with Microsoft
					</button>
				</div>
			{:else}
				<!-- Authenticated Content -->
				<h1 class="text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white mb-6">
					Spectra RAG
					<span class="text-blue-600 dark:text-blue-400">Development</span>
				</h1>
				<p class="text-xl text-gray-600 dark:text-gray-300 mb-8 max-w-2xl mx-auto">
					The Vector Database and Search and Rank is the lifeblood of Spectra's new smart recruitment engine. This is the current endeavor
				</p>
				<p class="text-lg text-gray-500 dark:text-gray-400 mb-12 max-w-2xl mx-auto">
					Instead of tying you to services piece by piece with multiple menus, we store everything in our vector database (AI-Native Database) where you can search for the best candidate across all platforms, unified together in one chat.
				</p>
				<div class="flex flex-col sm:flex-row gap-4 justify-center">
					<button
						onclick={() => goto('/spectra-job')}
						class="px-8 py-4 bg-blue-600 text-white rounded-lg font-semibold text-lg
						       hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
						       transition-colors shadow-lg hover:shadow-xl"
					>
						Start Chatting
					</button>
					<button
						onclick={() => {
							document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
						}}
						class="px-8 py-4 bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-2 border-gray-300 dark:border-gray-700 rounded-lg font-semibold text-lg
						       hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2
						       transition-colors"
					>
						Learn More
					</button>
				</div>
			{/if}
		</div>
	</section>

	<!-- Features Section -->
	<section id="features" class="px-6 py-20 bg-white dark:bg-gray-800">
		<div class="max-w-6xl mx-auto">
			<h2 class="text-4xl font-bold text-center text-gray-900 dark:text-white mb-12">
				Key Features
			</h2>
			<div class="grid md:grid-cols-3 gap-8">
				<!-- Feature 1 -->
				<div class="p-6 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border border-blue-200 dark:border-blue-800">
					<div class="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center mb-4">
						<svg
							class="w-6 h-6 text-white"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
							></path>
						</svg>
					</div>
					<h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
						Unified Search
					</h3>
					<p class="text-gray-600 dark:text-gray-300">
						Search across all platforms (Indeed, LinkedIn, Glassdoor, Taleo) in one unified interface.
					</p>
				</div>

				<!-- Feature 2 -->
				<div class="p-6 rounded-xl bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border border-purple-200 dark:border-purple-800">
					<div class="w-12 h-12 bg-purple-600 rounded-lg flex items-center justify-center mb-4">
						<svg
							class="w-6 h-6 text-white"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
							></path>
						</svg>
					</div>
					<h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
						Smart Ranking
					</h3>
					<p class="text-gray-600 dark:text-gray-300">
						AI-powered ranking algorithm that finds the best candidates based on your requirements.
					</p>
				</div>

				<!-- Feature 3 -->
				<div class="p-6 rounded-xl bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border border-green-200 dark:border-green-800">
					<div class="w-12 h-12 bg-green-600 rounded-lg flex items-center justify-center mb-4">
						<svg
							class="w-6 h-6 text-white"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M13 10V3L4 14h7v7l9-11h-7z"
							></path>
						</svg>
					</div>
					<h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
						AI-Native Database
					</h3>
					<p class="text-gray-600 dark:text-gray-300">
						Vector database powered by Cohere embeddings and Pinecone for lightning-fast semantic search.
					</p>
				</div>
			</div>
		</div>
	</section>

	<!-- How It Works Section -->
	<section class="px-6 py-20 bg-gray-50 dark:bg-gray-900">
		<div class="max-w-4xl mx-auto">
			<h2 class="text-4xl font-bold text-center text-gray-900 dark:text-white mb-12">
				How It Works
			</h2>
			<div class="space-y-8">
				<div class="flex gap-6">
					<div class="flex-shrink-0 w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-xl">
						1
					</div>
					<div>
						<h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
							Data Ingestion
						</h3>
						<p class="text-gray-600 dark:text-gray-300">
							Data is extracted from multiple sources (Indeed, LinkedIn, Glassdoor, Taleo) and cleaned for consistency.
						</p>
					</div>
				</div>

				<div class="flex gap-6">
					<div class="flex-shrink-0 w-12 h-12 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold text-xl">
						2
					</div>
					<div>
						<h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
							Vector Embedding
						</h3>
						<p class="text-gray-600 dark:text-gray-300">
							Candidate profiles are converted to embeddings using Cohere's embedding model and stored in Pinecone.
						</p>
					</div>
				</div>

				<div class="flex gap-6">
					<div class="flex-shrink-0 w-12 h-12 bg-green-600 text-white rounded-full flex items-center justify-center font-bold text-xl">
						3
					</div>
					<div>
						<h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
							Search & Rank
						</h3>
						<p class="text-gray-600 dark:text-gray-300">
							Your query is converted to an embedding, matched against candidates, and ranked using Cohere's reranker.
						</p>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- CTA Section -->
	<section class="px-6 py-20 bg-blue-600 dark:bg-blue-800">
		<div class="max-w-4xl mx-auto text-center">
			<h2 class="text-4xl font-bold text-white mb-6">
				Ready to Get Started?
			</h2>
			<p class="text-xl text-blue-100 mb-8">
				Start chatting with the Taleo API assistant and explore the power of RAG-based recruitment.
			</p>
			<button
				onclick={() => goto('/spectra-job')}
				class="px-8 py-4 bg-white text-blue-600 rounded-lg font-semibold text-lg
				       hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-blue-600
				       transition-colors shadow-lg hover:shadow-xl"
			>
				Launch RAG Agent
			</button>
		</div>
	</section>
</div>
