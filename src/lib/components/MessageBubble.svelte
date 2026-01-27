<script lang="ts">
	import type { ChatMessage } from '$lib/api/chat';
	import { formatMessageWithMarkdown } from '$lib/utils/sanitize';

	let { message, index = 0 }: { message: ChatMessage; index?: number } = $props();

	function formatTime(date: Date): string {
		return new Intl.DateTimeFormat('en-US', {
			hour: 'numeric',
			minute: '2-digit',
		}).format(date);
	}
</script>

<div
	class="flex mb-4 {message.role === 'user' ? 'justify-end' : 'justify-start'} message-enter"
	style="animation-delay: {Math.min(index * 0.05, 0.3)}s"
>
	<!-- Assistant avatar -->
	{#if message.role === 'assistant'}
		<div class="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center mr-3 mt-1 shadow-lg shadow-amber-500/20">
			<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
			</svg>
		</div>
	{/if}

	<div
		class="max-w-[80%] rounded-2xl px-4 py-3 {
			message.role === 'user'
				? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/20'
				: 'glass-light text-slate-100'
		}"
	>
		<div class="text-sm whitespace-pre-wrap break-words prose-chat">
			{@html formatMessageWithMarkdown(message.content)}
		</div>
		<div
			class="text-[10px] mt-1.5 {
				message.role === 'user' ? 'text-amber-100/70' : 'text-slate-500'
			}"
		>
			{formatTime(new Date(message.timestamp))}
		</div>
	</div>

	<!-- User avatar -->
	{#if message.role === 'user'}
		<div class="flex-shrink-0 w-8 h-8 rounded-full glass flex items-center justify-center ml-3 mt-1">
			<svg class="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
			</svg>
		</div>
	{/if}
</div>
