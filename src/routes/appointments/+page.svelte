<!-- src/routes/appointments/+page.svelte -->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import MessageList from '$lib/components/MessageList.svelte';
	import type { ChatMessage } from '$lib/api/chat';
	import type { MCPRequest } from '$lib/types/mcp';
	import { loadMessages, saveMessages, clearMessages } from '$lib/stores/chat-persistence';

	let { data }: { data: PageData } = $props();

	let messages = $state<ChatMessage[]>([]);
	let inputMessage = $state('');
	let isLoading = $state(false);
	let sessionId = $state('');
	let mounted = $state(false);

	// AbortController for cancelling requests on unmount
	let abortController: AbortController | null = null;

	// Batching for streaming updates to reduce re-renders
	let pendingContent = '';
	let updateScheduled = false;

	// Welcome message shown when no history exists
	const welcomeMessage: ChatMessage = {
		role: 'assistant',
		content: 'Hello! I can help you book appointments using your Microsoft Calendar. You can ask me to:\n\n• Find available time slots\n• Book an appointment\n• View your calendar events\n• List your calendars\n\nHow can I help you today?',
		timestamp: new Date().toISOString(),
	};

	onMount(() => {
		mounted = true;

		// Generate or get session ID
		const stored = localStorage.getItem('appointment-session-id');
		if (stored) {
			sessionId = stored;
		} else {
			// we use crypto ?!💯 soyjack
			sessionId = crypto.randomUUID();
			localStorage.setItem('appointment-session-id', sessionId);
		}

		// Load persisted messages or show welcome message, this is our users storage
		const persistedMessages = loadMessages('appointments');
		if (persistedMessages.length > 0) {
			messages = persistedMessages;
		} else {
			messages = [welcomeMessage];
			saveMessages('appointments', messages);
		}
	});

	// Cancel pending requests and cleanup on unmount
	onDestroy(() => {
		abortController?.abort();
		pendingContent = '';
		updateScheduled = false;
	});

	// Clear chat history and reset
	function handleClearChat() {
		if (confirm('Are you sure you want to clear the chat history?')) {
			clearMessages('appointments');
			messages = [welcomeMessage];
			saveMessages('appointments', messages);
		}
	}

	async function sendMessage() {
		if (!mounted || !inputMessage.trim() || isLoading) return;

		// cancel pending requests, cant believe you have to make everything take a f'ing undefined type
		abortController?.abort();
		abortController = new AbortController();

		const userMessage: ChatMessage = {
			role: 'user',
			content: inputMessage.trim(),
			timestamp: new Date().toISOString(),
		};

		messages = [...messages, userMessage];
		saveMessages('appointments', messages); // Persist immediately
		const messageToSend = inputMessage.trim();
		inputMessage = '';
		isLoading = true;

		// Add a placeholder for the streaming response
		const assistantMessage: ChatMessage = {
			role: 'assistant',
			content: '',
			timestamp: new Date().toISOString(),
		};
		messages = [...messages, assistantMessage];
		
		// Track the index of the assistant message for streaming updates
		const assistantMessageIndex = messages.length - 1;
		
		// Track accumulated content for streaming
		let streamedContent = '';

		try {
			// Ensure we're in the browser
			if (typeof window === 'undefined') {
				throw new Error('This function can only be called in the browser');
			}

			// Create MCP chat request with session ID for chat history persistence
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

			// Process the stream of piss
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();

				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Batched update function using requestAnimationFrame
				const flushPendingContent = () => {
					if (pendingContent && messages[assistantMessageIndex]) {
						messages[assistantMessageIndex].content += pendingContent;
						pendingContent = '';
						messages = [...messages]; // Trigger reactivity
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

				// Process complete SSE messages
				const lines = buffer.split('\n\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						try {
							const data = JSON.parse(line.slice(6));

							if (data.chunk) {
								// Batch chunks for smoother rendering
								scheduleUpdate(data.chunk);
							} else if (data.error) {
								// Flush any pending content before error
								flushPendingContent();
								throw new Error(data.error);
							} else if (data.done) {
								// Flush any remaining content
								flushPendingContent();
								break;
							}
						} catch (parseError: any) {
							if (parseError.message) {
								throw parseError; // Re-throw actual errors
							}
							console.error('Failed to parse SSE data:', line);
						}
					}
				}
			}

			// Final flush to ensure all content is rendered
			if (pendingContent && messages[assistantMessageIndex]) {
				messages[assistantMessageIndex].content += pendingContent;
				pendingContent = '';
				messages = [...messages];
			}

			// Save final state
			saveMessages('appointments', messages);
		} catch (error: any) {
			// Don't show error if request was aborted
			if (error instanceof Error && error.name === 'AbortError') {
				// Remove the incomplete assistant message
				messages = messages.slice(0, -1);
				return;
			}

			// Update the last message with error (create new array)
			const errorContent = `Error: ${error.message || 'An unexpected error occurred'}`;
			const lastIndex = messages.length - 1;
			messages = messages.map((msg, i) => 
				i === lastIndex 
					? { ...msg, content: errorContent }
					: msg
			);
			saveMessages('appointments', messages);
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

<div class="flex flex-col h-screen bg-gray-50 dark:bg-gray-900">
	<!-- Header -->
	<header class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
		<div class="max-w-4xl mx-auto flex justify-between items-start">
			<div>
				<h1 class="text-2xl font-bold text-gray-900 dark:text-white">
					Appointment Booking Assistant
				</h1>
				<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
					Powered by Microsoft Graph & Cohere Command
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

	<!-- Messages -->
	<div class="flex-1 overflow-y-auto px-6 py-4">
		<div class="max-w-4xl mx-auto">
			<MessageList messages={messages} />
		</div>
	</div>

	<!-- Input -->
	<div class="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-6 py-4">
		<div class="max-w-4xl mx-auto">
			<div class="flex gap-4">
				<div class="flex-1 relative">
					<textarea
						bind:value={inputMessage}
						onkeydown={handleKeyDown}
						placeholder="Ask me to book an appointment, find available slots, or view your calendar..."
						class="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 rounded-lg
						       bg-white dark:bg-gray-700 text-gray-900 dark:text-white
						       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
						       resize-none"
						rows="3"
						disabled={isLoading}
					></textarea>
				</div>
				<button
					onclick={sendMessage}
					disabled={isLoading || !inputMessage.trim()}
					class="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold
					       hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
					       disabled:opacity-50 disabled:cursor-not-allowed transition-colors
					       self-end"
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
			<p class="text-xs text-gray-500 dark:text-gray-400 mt-2">
				Press Enter to send, Shift+Enter for new line
			</p>
		</div>
	</div>
</div>
