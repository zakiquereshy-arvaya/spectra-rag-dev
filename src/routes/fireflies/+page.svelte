<!-- src/routes/fireflies/+page.svelte - Fireflies Meeting Assistant -->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import MessageList from '$lib/components/MessageList.svelte';
	import type { ChatMessage } from '$lib/api/chat';
	import { getSessionId, clearSessionId } from '$lib/stores/chat-persistence';

	let { data }: { data: PageData } = $props();

	let messages = $state<ChatMessage[]>([]);
	let inputMessage = $state('');
	let isLoading = $state(false);
	let isLoadingHistory = $state(true);
	let sessionId = $state('');
	let mounted = $state(false);
	let streamingContent = $state('');

	// Sources and suggestions from RAG
	let currentSources = $state<any[]>([]);
	let currentSuggestions = $state<string[]>([]);
	let showSources = $state(false);

	let abortController: AbortController | null = null;
	let textareaElement: HTMLTextAreaElement;

	const welcomeMessage: ChatMessage = {
		role: 'assistant',
		content: `Hi! I'm your **Meeting Assistant** powered by Fireflies.ai transcripts.

I can help you:

**Search Meetings**
- Find discussions on specific topics
- Locate meetings with particular participants

**Get Insights**
- Surface action items and follow-ups
- Summarize key decisions and outcomes

**Answer Questions**
- "What did we discuss about the Q4 budget?"
- "What action items came out of last week's standup?"

Just ask me anything about your meetings!`,
		timestamp: new Date().toISOString(),
	};

	onMount(async () => {
		mounted = true;
		sessionId = getSessionId('fireflies');

		try {
			const response = await fetch(`/fireflies/history?sessionId=${encodeURIComponent(sessionId)}`);
			if (response.ok) {
				const data = await response.json();
				if (data.messages && data.messages.length > 0) {
					messages = data.messages;
				} else {
					messages = [welcomeMessage];
				}
			} else {
				messages = [welcomeMessage];
			}
		} catch (error) {
			console.error('Error loading history:', error);
			messages = [welcomeMessage];
		} finally {
			isLoadingHistory = false;
		}
	});

	onDestroy(() => {
		abortController?.abort();
	});

	async function handleClearChat() {
		if (confirm('Clear chat history?')) {
			await fetch(`/fireflies/history?sessionId=${encodeURIComponent(sessionId)}`, {
				method: 'DELETE',
			});
			clearSessionId('fireflies');
			sessionId = getSessionId('fireflies');
			messages = [welcomeMessage];
			streamingContent = '';
			currentSources = [];
			currentSuggestions = [];
			showSources = false;
		}
	}

	async function sendMessage() {
		if (!mounted || !inputMessage.trim() || isLoading) return;

		abortController?.abort();
		abortController = new AbortController();

		const userMessage: ChatMessage = {
			role: 'user',
			content: inputMessage.trim(),
			timestamp: new Date().toISOString(),
		};

		messages = [...messages, userMessage];
		const messageToSend = inputMessage.trim();
		inputMessage = '';
		isLoading = true;
		streamingContent = '';
		currentSources = [];
		currentSuggestions = [];
		showSources = false;

		try {
			const response = await fetch('/fireflies/stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: messageToSend,
					sessionId: sessionId,
				}),
				signal: abortController.signal,
			});

			if (!response.ok) {
				throw new Error(`Request failed: ${response.statusText}`);
			}

			if (!response.body) {
				throw new Error('Response body is null');
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let fullContent = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						try {
							const data = JSON.parse(line.slice(6));

							if (data.chunk) {
								fullContent += data.chunk;
								streamingContent = fullContent;
							} else if (data.sources) {
								currentSources = data.sources;
							} else if (data.suggestions) {
								currentSuggestions = data.suggestions;
							} else if (data.error) {
								throw new Error(data.error);
							} else if (data.done) {
								break;
							}
						} catch (parseError: any) {
							if (parseError.message && parseError.message !== 'Unexpected end of JSON input') {
								throw parseError;
							}
						}
					}
				}
			}

			const assistantMessage: ChatMessage = {
				role: 'assistant',
				content: fullContent || 'No response received.',
				timestamp: new Date().toISOString(),
			};
			messages = [...messages, assistantMessage];
			streamingContent = '';
		} catch (error: any) {
			streamingContent = '';

			if (error instanceof Error && error.name === 'AbortError') {
				return;
			}

			const errorMessage: ChatMessage = {
				role: 'assistant',
				content: `Error: ${error.message || 'An unexpected error occurred'}`,
				timestamp: new Date().toISOString(),
			};
			messages = [...messages, errorMessage];
		} finally {
			isLoading = false;
			textareaElement?.focus();
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	}

	function formatDate(date: string | Date) {
		const d = typeof date === 'string' ? new Date(date) : date;
		return d.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
		});
	}
</script>

<div class="flex flex-col h-screen bg-slate-950">
	<!-- Header -->
	<header class="bg-slate-900/80 backdrop-blur-sm border-b border-slate-800 px-6 py-4 sticky top-0 z-10">
		<div class="max-w-4xl mx-auto flex justify-between items-center">
			<div class="flex items-center gap-4">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
						<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path>
						</svg>
					</div>
					<div>
						<h1 class="text-xl font-bold text-white">Meeting Assistant</h1>
						<p class="text-xs text-slate-500">Powered by Fireflies</p>
					</div>
				</div>

				{#if isLoading}
					<div class="flex items-center gap-2 px-3 py-1.5 rounded-full border text-purple-400 bg-purple-500/10 border-purple-500/20 text-xs font-medium">
						<svg class="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						Searching...
					</div>
				{/if}
			</div>

			<div class="flex items-center gap-2">
				{#if currentSources.length > 0}
					<button
						onclick={() => showSources = !showSources}
						class="px-3 py-1.5 text-sm text-purple-400 hover:text-purple-300 border border-purple-500/30 hover:border-purple-500/50 rounded-lg transition-colors flex items-center gap-1.5"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
						</svg>
						Sources ({currentSources.length})
					</button>
				{/if}
				<button
					onclick={handleClearChat}
					class="px-3 py-1.5 text-sm text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-500/50 rounded-lg transition-colors"
				>
					Clear Chat
				</button>
			</div>
		</div>
	</header>

	<!-- Sources Panel (collapsible) -->
	{#if showSources && currentSources.length > 0}
		<div class="bg-slate-900/50 border-b border-slate-800 px-6 py-4">
			<div class="max-w-4xl mx-auto">
				<h3 class="text-sm font-medium text-slate-400 mb-3">Referenced Meetings</h3>
				<div class="grid gap-2">
					{#each currentSources.slice(0, 5) as source}
						<div class="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
							<div class="flex items-start justify-between gap-3">
								<div class="flex-1 min-w-0">
									<h4 class="text-sm font-medium text-white truncate">{source.title}</h4>
									<p class="text-xs text-slate-500 mt-0.5">
										{formatDate(source.transcript_date)}
										{#if source.chunk_topic}
											<span class="text-slate-600">|</span> {source.chunk_topic}
										{/if}
									</p>
								</div>
								<div class="flex items-center gap-2">
									<span class="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
										{Math.round(source.similarity * 100)}%
									</span>
									{#if source.transcript_url}
										<a
											href={source.transcript_url}
											target="_blank"
											rel="noopener noreferrer"
											class="text-slate-400 hover:text-purple-400 transition-colors"
											title="Open transcript"
										>
											<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
											</svg>
										</a>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<!-- Messages -->
	<div class="flex-1 overflow-y-auto px-6 py-6">
		<div class="max-w-4xl mx-auto">
			{#if isLoadingHistory}
				<div class="flex items-center justify-center py-12">
					<div class="flex items-center gap-3 text-slate-400">
						<svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						<span>Loading conversation...</span>
					</div>
				</div>
			{:else}
				<MessageList {messages} />

				{#if streamingContent}
					<div class="py-3">
						<div class="bg-slate-800/50 border border-slate-700 rounded-xl px-5 py-4 text-slate-200">
							<div class="prose prose-invert prose-sm max-w-none whitespace-pre-wrap">
								{streamingContent}
							</div>
							<span class="inline-block w-2 h-5 bg-purple-500 animate-pulse ml-1 rounded-sm"></span>
						</div>
					</div>
				{/if}

				<!-- Suggestions based on action items -->
				{#if currentSuggestions.length > 0 && !isLoading}
					<div class="mt-4 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
						<h4 class="text-sm font-medium text-indigo-400 mb-2 flex items-center gap-2">
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path>
							</svg>
							Related Action Items
						</h4>
						<ul class="space-y-1.5">
							{#each currentSuggestions as suggestion}
								<li class="text-sm text-slate-300">{suggestion}</li>
							{/each}
						</ul>
					</div>
				{/if}
			{/if}
		</div>
	</div>

	<!-- Input -->
	<div class="bg-slate-900/80 backdrop-blur-sm border-t border-slate-800 px-6 py-4">
		<div class="max-w-4xl mx-auto">
			<div class="flex gap-3">
				<div class="flex-1 relative">
					<textarea
						bind:this={textareaElement}
						bind:value={inputMessage}
						onkeydown={handleKeyDown}
						placeholder="Ask about your meetings..."
						class="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl
						       text-white placeholder-slate-500
						       focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50
						       resize-none transition-all"
						rows="2"
						disabled={isLoading || isLoadingHistory}
					></textarea>
				</div>
				<button
					onclick={sendMessage}
					disabled={isLoading || isLoadingHistory || !inputMessage.trim()}
					class="px-5 py-3 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-xl font-medium
					       hover:from-purple-400 hover:to-indigo-500
					       disabled:opacity-50 disabled:cursor-not-allowed
					       focus:outline-none focus:ring-2 focus:ring-purple-500/50
					       transition-all self-end shadow-lg shadow-purple-500/20"
				>
					{#if isLoading}
						<svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
					{:else}
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
						</svg>
					{/if}
				</button>
			</div>
			<p class="text-xs text-slate-600 mt-2 text-center">
				Press Enter to send
			</p>
		</div>
	</div>
</div>
