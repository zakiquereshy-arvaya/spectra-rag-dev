<!-- src/routes/spectra-job/+page.svelte - v4 -->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import MessageList from '$lib/components/MessageList.svelte';
	import type { ChatMessage } from '$lib/api/chat';
	import {
		getSessionId,
		fetchChatHistory,
		clearServerHistory,
		clearSessionId,
	} from '$lib/stores/chat-persistence';

	let messages = $state<ChatMessage[]>([]);
	let inputValue = $state('');
	let isLoading = $state(false);
	let isLoadingHistory = $state(true);
	let error = $state<string | null>(null);
	let inputElement: HTMLTextAreaElement | undefined;
	let sessionId = $state('');

	// Separate state for streaming content - displayed inline
	let streamingContent = $state('');

	let abortController: AbortController | null = null;

	// Welcome message shown when no history exists
	const welcomeMessage: ChatMessage = {
		role: 'assistant',
		content:
			"Hello! I'm the Taleo API Assistant. I can help you with:\n\n\u2022 Taleo API endpoints and documentation\n\u2022 Authentication and parameters\n\u2022 Spectra's recruiting requirements\n\u2022 Integration best practices\n\nWhat would you like to know?",
		timestamp: new Date().toISOString(),
	};

	async function handleSend() {
		const message = inputValue.trim();
		if (!message || isLoading) return;

		abortController?.abort();
		abortController = new AbortController();

		const userMessage: ChatMessage = {
			role: 'user',
			content: message,
			timestamp: new Date().toISOString(),
		};
		messages = [...messages, userMessage];
		inputValue = '';
		isLoading = true;
		error = null;
		streamingContent = '';

		try {
			const response = await fetch('/spectra-job/stream', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					message,
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

			// Process the stream - accumulate locally
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let fullContent = '';

			while (true) {
				const { done, value } = await reader.read();

				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Process complete SSE messages
				const lines = buffer.split('\n\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						try {
							const data = JSON.parse(line.slice(6));

							if (data.chunk) {
								fullContent += data.chunk;
								// Update streaming display (throttled)
								streamingContent = fullContent;
							} else if (data.error) {
								throw new Error(data.error);
							} else if (data.done) {
								break;
							}
						} catch (parseError) {
							if (parseError instanceof Error && parseError.message !== 'Unexpected end of JSON input') {
								throw parseError;
							}
						}
					}
				}
			}

			// Add final message to array ONCE at the end
			const assistantMessage: ChatMessage = {
				role: 'assistant',
				content: fullContent || 'No response received.',
				timestamp: new Date().toISOString(),
			};
			messages = [...messages, assistantMessage];
			streamingContent = '';
			error = null;
		} catch (err) {
			streamingContent = '';

			// Don't show error if request was aborted
			if (err instanceof Error && err.name === 'AbortError') {
				return;
			}

			error = err instanceof Error ? err.message : 'Failed to send message';
			console.error('Chat error:', err);

			// Add error message
			const errorMessage: ChatMessage = {
				role: 'assistant',
				content: `Error: ${error}`,
				timestamp: new Date().toISOString(),
			};
			messages = [...messages, errorMessage];
		} finally {
			isLoading = false;
			setTimeout(() => inputElement?.focus(), 100);
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			handleSend();
		}
	}

	async function handleClearChat() {
		if (confirm('Are you sure you want to clear the chat history?')) {
			await clearServerHistory('spectraJob', sessionId);
			clearSessionId('spectraJob');
			sessionId = getSessionId('spectraJob');
			messages = [welcomeMessage];
			error = null;
			streamingContent = '';
		}
	}

	onMount(async () => {
		sessionId = getSessionId('spectraJob');

		try {
			const serverHistory = await fetchChatHistory('spectraJob', sessionId);
			if (serverHistory.length > 0) {
				messages = serverHistory;
			} else {
				messages = [welcomeMessage];
			}
		} catch (err) {
			console.error('Error loading history:', err);
			messages = [welcomeMessage];
		} finally {
			isLoadingHistory = false;
			inputElement?.focus();
		}
	});

	onDestroy(() => {
		abortController?.abort();
	});
</script>

<div class="flex flex-col h-screen">
	<!-- Header -->
	<header class="glass sticky top-0 z-10 px-6 py-4 lg:pl-6">
		<div class="flex justify-between items-start max-w-4xl mx-auto">
			<div>
				<h1 class="text-2xl font-bold text-white">Taleo API Assistant</h1>
				<p class="text-sm text-slate-500 mt-1">
					Get help with Taleo API and Spectra requirements
				</p>
			</div>
			<button
				onclick={handleClearChat}
				class="px-3 py-1.5 text-sm text-slate-400 hover:text-red-400 glass hover:border-red-500/50 rounded-lg transition-colors btn-press"
				title="Clear chat history"
			>
				Clear Chat
			</button>
		</div>
	</header>

	<!-- Messages Area -->
	<div class="flex-1 overflow-y-auto">
		{#if isLoadingHistory}
			<div class="flex items-center justify-center py-8">
				<svg
					class="animate-spin h-8 w-8 text-amber-500"
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
				>
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
				</svg>
				<span class="ml-2 text-slate-400">Loading conversation...</span>
			</div>
		{:else}
			<MessageList {messages} />

			<!-- Streaming content displayed separately -->
			{#if streamingContent}
				<div class="px-4 py-2">
					<div class="max-w-3xl ml-auto">
						<div class="glass-light rounded-2xl px-4 py-3 text-slate-100 whitespace-pre-wrap">
							{streamingContent}
							<span class="inline-block w-2 h-4 bg-amber-500 rounded-full animate-pulse ml-1"></span>
						</div>
					</div>
				</div>
			{/if}
		{/if}
	</div>

	<!-- Error Display -->
	{#if error}
		<div class="px-4 py-2 bg-red-500/10 border-t border-red-500/20 text-red-400 text-sm">
			Error: {error}
		</div>
	{/if}

	<!-- Input Area -->
	<div class="glass px-4 py-4">
		<div class="flex gap-2 max-w-4xl mx-auto">
			<textarea
				bind:this={inputElement}
				bind:value={inputValue}
				onkeydown={handleKeyDown}
				placeholder="Ask about Taleo API endpoints, Spectra requirements, or integration details..."
				disabled={isLoading || isLoadingHistory}
				class="flex-1 px-4 py-3 glass-input rounded-xl
				       text-white placeholder-slate-500
				       focus:outline-none
				       disabled:opacity-50 disabled:cursor-not-allowed
				       resize-none"
				rows="3"
			></textarea>
			<button
				onclick={handleSend}
				disabled={isLoading || isLoadingHistory || !inputValue.trim()}
				class="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl font-medium
				       hover:from-amber-400 hover:to-orange-500
				       disabled:opacity-50 disabled:cursor-not-allowed
				       focus:outline-none focus:ring-2 focus:ring-amber-500/50
				       transition-all btn-press btn-glow"
			>
				{#if isLoading}
					<svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
				{:else}
					Send
				{/if}
			</button>
		</div>
		<p class="text-xs text-slate-600 mt-2 max-w-4xl mx-auto">
			Press Enter to send, Shift+Enter for new line
		</p>
	</div>
</div>
