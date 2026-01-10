<!-- src/routes/+page.svelte -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { sessionStore } from '$lib/stores/session';
	import { sendMessage, type ChatMessage } from '$lib/api/chat';
	import MessageList from '$lib/components/MessageList.svelte';

	// State management using Svelte 5 runes
	let messages = $state<ChatMessage[]>([]);
	let inputValue = $state('');
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let inputElement: HTMLTextAreaElement | undefined;

	async function handleSend() {
		const message = inputValue.trim();
		if (!message || isLoading) return;

		// Add user message to chat
		const userMessage: ChatMessage = {
			role: 'user',
			content: message,
			timestamp: new Date().toISOString(),
		};
		messages = [...messages, userMessage];
		inputValue = '';
		isLoading = true;
		error = null;

		try {
			// Send to API
			const response = await sendMessage(sessionStore.id, message);

			// Add assistant response to chat
			const assistantMessage: ChatMessage = {
				role: 'assistant',
				content: response,
				timestamp: new Date().toISOString(),
			};
			messages = [...messages, assistantMessage];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to send message';
			console.error('Chat error:', err);
		} finally {
			isLoading = false;
			// Refocus input after sending
			setTimeout(() => inputElement?.focus(), 100);
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		// Send on Enter (but allow Shift+Enter for new line)
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			handleSend();
		}
	}

	// Focus input on mount
	onMount(() => {
		inputElement?.focus();
	});
</script>

<div class="flex flex-col h-screen bg-white dark:bg-gray-900">
	<!-- Header -->
	<header class="border-b border-gray-200 dark:border-gray-700 px-6 py-4 lg:pl-6">
		<h1 class="text-2xl font-bold text-gray-900 dark:text-white">
			Taleo API Assistant
		</h1>
		<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
			Get help with Taleo API and Spectra RAG implementation
		</p>
	</header>

	<!-- Messages Area -->
	<MessageList {messages} />

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
				placeholder="Type your message... (Press Enter to send, Shift+Enter for new line)"
				disabled={isLoading}
				class="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg 
				       bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
				       focus:outline-none focus:ring-2 focus:ring-blue-500
				       disabled:opacity-50 disabled:cursor-not-allowed
				       resize-none"
				rows="3"
			></textarea>
			<button
				onclick={handleSend}
				disabled={isLoading || !inputValue.trim()}
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
	</div>
</div>