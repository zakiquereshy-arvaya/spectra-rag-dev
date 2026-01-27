<!-- src/lib/components/MessageList.svelte -->
<script lang="ts">
	import MessageBubble from './MessageBubble.svelte';
	import type { ChatMessage } from '../api/chat';

	interface Props {
		messages: ChatMessage[];
		isLoading?: boolean;
		emptyTitle?: string;
		emptySubtitle?: string;
	}

	let {
		messages,
		isLoading = false,
		emptyTitle = 'Welcome!',
		emptySubtitle = 'Start a conversation to get started.',
	}: Props = $props();

	// Auto-scroll to bottom when new messages arrive
	let containerElement: HTMLDivElement;

	$effect(() => {
		if (containerElement && messages.length > 0) {
			containerElement.scrollTo({ top: containerElement.scrollHeight, behavior: 'smooth' });
		}
	});
</script>

<div
	bind:this={containerElement}
	class="flex-1 overflow-y-auto px-4 py-4 space-y-2"
>
	{#if messages.length === 0}
		<div class="flex items-center justify-center h-full text-slate-400">
			<div class="text-center">
				<div class="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
					<svg class="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
					</svg>
				</div>
				<p class="text-lg font-medium text-white mb-2">{emptyTitle}</p>
				<p class="text-sm text-slate-500">{emptySubtitle}</p>
			</div>
		</div>
	{:else}
		{#each messages as message, i (message.timestamp)}
			<MessageBubble {message} index={i} />
		{/each}
	{/if}

	{#if isLoading}
		<div class="flex justify-start mb-4">
			<div class="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center mr-3 mt-1 shadow-lg shadow-amber-500/20">
				<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
				</svg>
			</div>
			<div class="glass-light rounded-2xl">
				<div class="typing-indicator">
					<span></span>
					<span></span>
					<span></span>
				</div>
			</div>
		</div>
	{/if}
</div>
