<script lang="ts">
	import type { ChatMessage } from '$lib/api/chat';
	import { formatMessageWithMarkdown } from '$lib/utils/sanitize';

	let { message }: { message: ChatMessage } = $props();

	function formatTime(date: Date): string {
		return new Intl.DateTimeFormat('en-US', {
			hour: 'numeric',
			minute: '2-digit',
		}).format(date);
	}
</script>


<div class="flex mb-4 {message.role === 'user' ? 'justify-end' : 'justify-start'}">
	<div
		class="max-w-[80%] rounded-lg px-4 py-3 {
			message.role === 'user'
				? 'bg-blue-500 text-white'
				: 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
		}"
	>
		<div class="text-sm whitespace-pre-wrap break-words">
			{@html formatMessageWithMarkdown(message.content)}
		</div>
		<div
			class="text-xs mt-1 {
				message.role === 'user' ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'
			}"
		>
			{formatTime(new Date(message.timestamp))}
		</div>
	</div>
</div>