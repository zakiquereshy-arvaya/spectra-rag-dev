<!-- src/routes/moe/+page.svelte - Billi AI Assistant -->
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

	// Current mode indicator from classification
	let currentMode = $state<'calendar' | 'billing' | 'assistant'>('assistant');
	let currentConfidence = $state<number>(0);

	let abortController: AbortController | null = null;
	let textareaElement: HTMLTextAreaElement;

	const welcomeMessage: ChatMessage = {
		role: 'assistant',
		content: `Hi! I'm **Billi**, your AI assistant for Arvaya.

I can help you with:

**Calendar & Scheduling**
- Check availability for team members
- Book meetings with Teams links

**Time Tracking**
- Log time entries to QuickBooks
- Look up employees and customers

Just ask me what you need!`,
		timestamp: new Date().toISOString(),
	};

	onMount(async () => {
		mounted = true;
		sessionId = getSessionId('moe');

		try {
			const response = await fetch(`/moe/history?sessionId=${encodeURIComponent(sessionId)}`);
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
			await fetch(`/moe/history?sessionId=${encodeURIComponent(sessionId)}`, {
				method: 'DELETE',
			});
			clearSessionId('moe');
			sessionId = getSessionId('moe');
			messages = [welcomeMessage];
			streamingContent = '';
			currentMode = 'assistant';
			currentConfidence = 0;
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
		currentMode = 'assistant';
		currentConfidence = 0;

		try {
			const response = await fetch('/moe/stream', {
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
								const classificationMatch = data.chunk.match(/\[CLASSIFICATION:(.+?)\]/);
								if (classificationMatch) {
									try {
										const classification = JSON.parse(classificationMatch[1]);
										currentConfidence = classification.confidence;
										currentMode = classification.expert === 'appointments' ? 'calendar'
											: classification.expert === 'billing' ? 'billing' : 'assistant';
									} catch {}
									const cleanChunk = data.chunk.replace(/\[CLASSIFICATION:.+?\]\n?/, '');
									if (cleanChunk) {
										fullContent += cleanChunk;
										streamingContent = fullContent;
									}
								} else {
									fullContent += data.chunk;
									streamingContent = fullContent;
								}
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

			fullContent = fullContent.replace(/\[CLASSIFICATION:.+?\]\n?/g, '');
			fullContent = fullContent.replace(/\[Processing.*?\]\n*/g, '');

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

	function getModeConfig(mode: 'calendar' | 'billing' | 'assistant') {
		switch (mode) {
			case 'calendar':
				return {
					label: 'Calendar',
					icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
					color: 'text-sky-400 bg-sky-500/10 border-sky-500/20'
				};
			case 'billing':
				return {
					label: 'Time Entry',
					icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
					color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
				};
			default:
				return {
					label: 'Assistant',
					icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
					color: 'text-amber-400 bg-amber-500/10 border-amber-500/20'
				};
		}
	}

	let modeConfig = $derived(getModeConfig(currentMode));
</script>

<div class="flex flex-col h-screen bg-slate-950">
	<!-- Header -->
	<header class="bg-slate-900/80 backdrop-blur-sm border-b border-slate-800 px-6 py-4 sticky top-0 z-10">
		<div class="max-w-4xl mx-auto flex justify-between items-center">
			<div class="flex items-center gap-4">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
						<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
						</svg>
					</div>
					<div>
						<h1 class="text-xl font-bold text-white">Billi</h1>
						<p class="text-xs text-slate-500">AI Assistant</p>
					</div>
				</div>

				{#if isLoading}
					<div class="flex items-center gap-2 px-3 py-1.5 rounded-full border {modeConfig.color} text-xs font-medium">
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={modeConfig.icon}></path>
						</svg>
						{modeConfig.label}
						{#if currentConfidence > 0}
							<span class="opacity-70">({Math.round(currentConfidence * 100)}%)</span>
						{/if}
					</div>
				{/if}
			</div>

			<button
				onclick={handleClearChat}
				class="px-3 py-1.5 text-sm text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-500/50 rounded-lg transition-colors"
			>
				Clear Chat
			</button>
		</div>
	</header>

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
							<span class="inline-block w-2 h-5 bg-amber-500 animate-pulse ml-1 rounded-sm"></span>
						</div>
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
						placeholder="Ask Billi anything..."
						class="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl
						       text-white placeholder-slate-500
						       focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50
						       resize-none transition-all"
						rows="2"
						disabled={isLoading || isLoadingHistory}
					></textarea>
				</div>
				<button
					onclick={sendMessage}
					disabled={isLoading || isLoadingHistory || !inputMessage.trim()}
					class="px-5 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl font-medium
					       hover:from-amber-400 hover:to-orange-500
					       disabled:opacity-50 disabled:cursor-not-allowed
					       focus:outline-none focus:ring-2 focus:ring-amber-500/50
					       transition-all self-end shadow-lg shadow-amber-500/20"
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
