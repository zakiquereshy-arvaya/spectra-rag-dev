<!-- src/lib/components/MessageList.svelte -->
<script lang="ts">
	import MessageBubble from './MessageBubble.svelte';
	import type { ChatMessage } from '../api/chat';

	interface Props {
		messages: ChatMessage[];
	}

	let { messages }: Props = $props();

	// Auto-scroll to bottom when new messages arrive
	let containerElement: HTMLDivElement;

	$effect(() => {
		if (containerElement && messages.length > 0) {
			containerElement.scrollTop = containerElement.scrollHeight;
		}
	});
</script>

<div
	bind:this={containerElement}
	class="flex-1 overflow-y-auto px-4 py-4 space-y-2"
>
	{#if messages.length === 0}
		<div class="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
			<div class="text-center">
				<p class="text-lg font-medium mb-2">Welcome!</p>
				<p class="text-sm">Start a conversation with the Taleo API assistant.</p>
			</div>
		</div>
	{:else}
		{#each messages as message (message.timestamp)}
			<MessageBubble {message} />
		{/each}
	{/if}
</div>