<!-- src/routes/appointments/+page.svelte -->
<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import MessageList from '$lib/components/MessageList.svelte';
	import type { ChatMessage } from '$lib/api/chat';
	import type { MCPRequest } from '$lib/types/mcp';

	let { data }: { data: PageData } = $props();

	let messages = $state<ChatMessage[]>([]);
	let inputMessage = $state('');
	let isLoading = $state(false);
	let sessionId = $state('');
	let mounted = $state(false);

	onMount(() => {
		mounted = true;
		
		// Generate or get session ID
		const stored = localStorage.getItem('appointment-session-id');
		if (stored) {
			sessionId = stored;
		} else {
			sessionId = crypto.randomUUID();
			localStorage.setItem('appointment-session-id', sessionId);
		}

		// Add welcome message
		messages = [
			{
				role: 'assistant',
				content: 'Hello! I can help you book appointments using your Microsoft Calendar. You can ask me to:\n\n• Find available time slots\n• Book an appointment\n• View your calendar events\n• List your calendars\n\nHow can I help you today?',
				timestamp: new Date().toISOString(),
			},
		];
	});

	async function sendMessage() {
		if (!mounted || !inputMessage.trim() || isLoading) return;

		const userMessage: ChatMessage = {
			role: 'user',
			content: inputMessage.trim(),
			timestamp: new Date().toISOString(),
		};

		messages = [...messages, userMessage];
		const messageToSend = inputMessage.trim();
		inputMessage = '';
		isLoading = true;

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
					sessionId: sessionId, // Include session ID to maintain chat history
				},
			};

			const response = await fetch('/appointments/api', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(mcpRequest),
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error?.message || 'Failed to process request');
			}

			const result = await response.json();

			if (result.error) {
				throw new Error(result.error.message);
			}

			const assistantMessage: ChatMessage = {
				role: 'assistant',
				content: result.result?.content?.[0]?.text || 'No response received',
				timestamp: new Date().toISOString(),
			};

			messages = [...messages, assistantMessage];
		} catch (error: any) {
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

<div class="flex flex-col h-screen bg-gray-50 dark:bg-gray-900">
	<!-- Header -->
	<header class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
		<div class="max-w-4xl mx-auto">
			<h1 class="text-2xl font-bold text-gray-900 dark:text-white">
				Appointment Booking Assistant
			</h1>
			<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
				Powered by Microsoft Graph & Cohere Command
			</p>
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
