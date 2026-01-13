<!-- src/routes/spectra-job/+page.svelte -->
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

	let abortController: AbortController | null = null;

	// Batching for streaming updates to reduce re-renders
	let pendingContent = '';
	let updateScheduled = false;

	// Welcome message shown when no history exists
	const welcomeMessage: ChatMessage = {
		role: 'assistant',
		content:
			"Hello! I'm the Taleo API Assistant. I can help you with:\n\n• Taleo API endpoints and documentation\n• Authentication and parameters\n• Spectra's recruiting requirements\n• Integration best practices\n\nWhat would you like to know?",
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

		const assistantMessageIndex = messages.length;
		const assistantMessage: ChatMessage = {
			role: 'assistant',
			content: '',
			timestamp: new Date().toISOString(),
		};
		messages = [...messages, assistantMessage];

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

			// Process the stream
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			// Batched update function using requestAnimationFrame
			const flushPendingContent = () => {
				if (pendingContent && messages[assistantMessageIndex]) {
					messages[assistantMessageIndex].content += pendingContent;
					pendingContent = '';
					messages = [...messages];
				}
				updateScheduled = false;
			};

			const scheduleUpdate = (chunk: string) => {
				pendingContent += chunk;
				if (!updateScheduled) {
					updateScheduled = true;
					requestAnimationFrame(flushPendingContent);
				}
			};

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
								scheduleUpdate(data.chunk);
							} else if (data.error) {
								flushPendingContent();
								throw new Error(data.error);
							} else if (data.done) {
								flushPendingContent();
								break;
							}
						} catch (parseError) {
							if (
								parseError instanceof Error &&
								parseError.message !== 'Unexpected end of JSON input'
							) {
								console.error('Failed to parse SSE data:', line);
							}
						}
					}
				}
			}

			// Final flush
			if (pendingContent && messages[assistantMessageIndex]) {
				messages[assistantMessageIndex].content += pendingContent;
				pendingContent = '';
				messages = [...messages];
			}

			error = null;
		} catch (err) {
			// Don't show error if request was aborted
			if (err instanceof Error && err.name === 'AbortError') {
				messages = messages.slice(0, -1);
				return;
			}
			error = err instanceof Error ? err.message : 'Failed to send message';
			console.error('Chat error:', err);

			// Update assistant message with error
			if (messages[assistantMessageIndex]) {
				messages[assistantMessageIndex].content = `Error: ${error}`;
				messages = [...messages];
			}
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
			// Clear on server
			await clearServerHistory('spectraJob', sessionId);
			// Clear session ID to start fresh
			clearSessionId('spectraJob');
			// Get new session ID
			sessionId = getSessionId('spectraJob');
			// Reset UI
			messages = [welcomeMessage];
			error = null;
		}
	}

	// Load chat history from server on mount
	onMount(async () => {
		// Get or create session ID (stored in sessionStorage, clears when browser closes)
		sessionId = getSessionId('spectraJob');

		// Fetch chat history from server
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

	// Cancel pending requests and cleanup on unmount
	onDestroy(() => {
		abortController?.abort();
		pendingContent = '';
		updateScheduled = false;
	});
</script>

<div class="flex flex-col h-screen bg-white dark:bg-gray-900">
	<!-- Header -->
	<header class="border-b border-gray-200 dark:border-gray-700 px-6 py-4 lg:pl-6">
		<div class="flex justify-between items-start max-w-4xl mx-auto">
			<div>
				<h1 class="text-2xl font-bold text-gray-900 dark:text-white">Taleo API Assistant</h1>
				<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
					Get help with Taleo API and Spectra requirements
				</p>
			</div>
			<button
				onclick={handleClearChat}
				class="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400
				       border border-gray-300 dark:border-gray-600 rounded-lg hover:border-red-300 dark:hover:border-red-600
				       transition-colors"
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
					class="animate-spin h-8 w-8 text-blue-500"
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
				>
					<circle
						class="opacity-25"
						cx="12"
						cy="12"
						r="10"
						stroke="currentColor"
						stroke-width="4"
					></circle>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					></path>
				</svg>
				<span class="ml-2 text-gray-500 dark:text-gray-400">Loading conversation...</span>
			</div>
		{:else}
			<MessageList {messages} />
		{/if}
	</div>

	<!-- Error Display -->
	{#if error}
		<div class="px-4 py-2 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 text-sm">
			Error: {error}
		</div>
	{/if}

	<!-- Input Area -->
	<div class="border-t border-gray-200 dark:border-gray-700 px-4 py-4">
		<div class="flex gap-2 max-w-4xl mx-auto">
			<textarea
				bind:this={inputElement}
				bind:value={inputValue}
				onkeydown={handleKeyDown}
				placeholder="Ask about Taleo API endpoints, Spectra requirements, or integration details..."
				disabled={isLoading || isLoadingHistory}
				class="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg
				       bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
				       focus:outline-none focus:ring-2 focus:ring-blue-500
				       disabled:opacity-50 disabled:cursor-not-allowed
				       resize-none"
				rows="3"
			></textarea>
			<button
				onclick={handleSend}
				disabled={isLoading || isLoadingHistory || !inputValue.trim()}
				class="px-6 py-3 bg-blue-500 text-white rounded-lg font-medium
				       hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed
				       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
				       transition-colors"
			>
				{#if isLoading}
					<svg
						class="animate-spin h-5 w-5"
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
					>
						<circle
							class="opacity-25"
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							stroke-width="4"
						></circle>
						<path
							class="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
						></path>
					</svg>
				{:else}
					Send
				{/if}
			</button>
		</div>
		<p class="text-xs text-gray-500 dark:text-gray-400 mt-2 max-w-4xl mx-auto">
			Press Enter to send, Shift+Enter for new line
		</p>
	</div>
</div>
