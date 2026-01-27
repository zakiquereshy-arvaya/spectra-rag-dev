<!-- src/routes/appointments/+page.svelte - v4 -->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import MessageList from '$lib/components/MessageList.svelte';
	import type { ChatMessage } from '$lib/api/chat';
	import type { MCPRequest } from '$lib/types/mcp';
	import {
		getSessionId,
		fetchChatHistory,
		clearServerHistory,
		clearSessionId,
	} from '$lib/stores/chat-persistence';

	let { data }: { data: PageData } = $props();

	let messages = $state<ChatMessage[]>([]);
	let inputMessage = $state('');
	let isLoading = $state(false);
	let isLoadingHistory = $state(true);
	let sessionId = $state('');
	let mounted = $state(false);

	// Separate state for streaming content - displayed inline
	let streamingContent = $state('');

	// AbortController for cancelling requests on unmount
	let abortController: AbortController | null = null;

	// Welcome message shown when no history exists
	const welcomeMessage: ChatMessage = {
		role: 'assistant',
		content:
			'Hello! I can help you book appointments using your Microsoft Calendar. You can ask me to:\n\n\u2022 Find available time slots\n\u2022 Book an appointment\n\u2022 View your calendar events\n\u2022 List your calendars\n\nHow can I help you today?',
		timestamp: new Date().toISOString(),
	};

	onMount(async () => {
		mounted = true;

		// Get or create session ID (stored in sessionStorage, clears when browser closes)
		sessionId = getSessionId('appointments');

		// Fetch chat history from server
		try {
			const serverHistory = await fetchChatHistory('appointments', sessionId);
			if (serverHistory.length > 0) {
				messages = serverHistory;
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

	// Cancel pending requests on unmount
	onDestroy(() => {
		abortController?.abort();
	});

	// Clear chat history and reset
	async function handleClearChat() {
		if (confirm('Are you sure you want to clear the chat history?')) {
			await clearServerHistory('appointments', sessionId);
			clearSessionId('appointments');
			sessionId = getSessionId('appointments');
			messages = [welcomeMessage];
			streamingContent = '';
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

		try {
			if (typeof window === 'undefined') {
				throw new Error('This function can only be called in the browser');
			}

			const mcpRequest: MCPRequest = {
				jsonrpc: '2.0',
				id: Date.now(),
				method: 'chat',
				params: {
					message: messageToSend,
					sessionId: sessionId,
				},
			};

			const response = await fetch('/appointments/stream', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(mcpRequest),
				signal: abortController.signal,
			});

			if (!response.ok) {
				throw new Error(`Failed to process request: ${response.statusText}`);
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
								// Update streaming display
								streamingContent = fullContent;
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

			// Add final message to array ONCE at the end
			const assistantMessage: ChatMessage = {
				role: 'assistant',
				content: fullContent || 'No response received.',
				timestamp: new Date().toISOString(),
			};
			messages = [...messages, assistantMessage];
			streamingContent = '';
		} catch (error: any) {
			streamingContent = '';

			// Don't show error if request was aborted
			if (error instanceof Error && error.name === 'AbortError') {
				return;
			}

			// Add error message
			const errorMessage: ChatMessage = {
				role: 'assistant',
				content: `Error: ${error.message || 'An unexpected error occurred'}`,
				timestamp: new Date().toISOString(),
			};
			messages = [...messages, errorMessage];
		} finally {
			isLoading = false;
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	}
</script>

<div class="flex flex-col h-screen">
	<!-- Header -->
	<header class="glass sticky top-0 z-10 px-6 py-4">
		<div class="max-w-4xl mx-auto flex justify-between items-start">
			<div>
				<h1 class="text-2xl font-bold text-white">
					Appointment Booking Assistant
				</h1>
				<p class="text-sm text-slate-500 mt-1">
					Powered by Microsoft Graph & Cohere Command
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

	<!-- Messages -->
	<div class="flex-1 overflow-y-auto px-6 py-4">
		<div class="max-w-4xl mx-auto">
			{#if isLoadingHistory}
				<div class="flex items-center justify-center py-8">
					<svg class="animate-spin h-8 w-8 text-amber-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					<span class="ml-2 text-slate-400">Loading conversation...</span>
				</div>
			{:else}
				<MessageList {messages} />

				<!-- Streaming content displayed separately -->
				{#if streamingContent}
					<div class="py-2">
						<div class="glass-light rounded-2xl px-4 py-3 text-slate-100 whitespace-pre-wrap">
							{streamingContent}
							<span class="inline-block w-2 h-4 bg-amber-500 rounded-full animate-pulse ml-1"></span>
						</div>
					</div>
				{/if}
			{/if}
		</div>
	</div>

	<!-- Input -->
	<div class="glass px-6 py-4">
		<div class="max-w-4xl mx-auto">
			<div class="flex gap-4">
				<div class="flex-1 relative">
					<textarea
						bind:value={inputMessage}
						onkeydown={handleKeyDown}
						placeholder="Ask me to book an appointment, find available slots, or view your calendar..."
						class="w-full px-4 py-3 pr-12 glass-input rounded-xl
						       text-white placeholder-slate-500
						       focus:outline-none
						       resize-none"
						rows="3"
						disabled={isLoading || isLoadingHistory}
					></textarea>
				</div>
				<button
					onclick={sendMessage}
					disabled={isLoading || isLoadingHistory || !inputMessage.trim()}
					class="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl font-semibold
					       hover:from-amber-400 hover:to-orange-500
					       disabled:opacity-50 disabled:cursor-not-allowed
					       focus:outline-none focus:ring-2 focus:ring-amber-500/50
					       transition-all self-end btn-press btn-glow"
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
			<p class="text-xs text-slate-600 mt-2">
				Press Enter to send, Shift+Enter for new line
			</p>
		</div>
	</div>
</div>
