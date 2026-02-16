<script lang="ts">
	import type { ChatMessage } from '$lib/api/chat';
	import { formatMessageWithMarkdown } from '$lib/utils/sanitize';
	import { fade, fly, scale } from 'svelte/transition';
	import { cubicOut, quintOut } from 'svelte/easing';
	import AvailabilityCard from './AvailabilityCard.svelte';
	import TeamAvailabilityCard from './TeamAvailabilityCard.svelte';
	import BookingCard from './BookingCard.svelte';
	import TimeEntryCard from './TimeEntryCard.svelte';

	let {
		message,
		index = 0,
		onSlotClick,
		onSuggestionClick,
	}: {
		message: ChatMessage;
		index?: number;
		onSlotClick?: (text: string) => void;
		onSuggestionClick?: (action: string) => void;
	} = $props();

	function formatTime(date: Date): string {
		return new Intl.DateTimeFormat('en-US', {
			hour: 'numeric',
			minute: '2-digit',
		}).format(date);
	}

	let hasCard = $derived(!!message.toolResult);
	let hasSuggestions = $derived(!!message.suggestions && message.suggestions.length > 0);
	let entranceDelay = $derived.by(() => Math.min(index * 36, 220));
</script>

<div
	class="mb-4 flex {message.role === 'user' ? 'justify-end' : 'justify-start'}"
	in:fly={{
		y: 10,
		x: message.role === 'user' ? 10 : -10,
		delay: entranceDelay,
		duration: 320,
		easing: quintOut
	}}
>
	<!-- Assistant avatar -->
	{#if message.role === 'assistant'}
		<div class="flex-shrink-0 mr-3 mt-1">
			<!-- Billi SVG Avatar -->
			<div class="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20 relative">
				<svg class="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
				</svg>
			</div>
		</div>
	{/if}

	<div class="max-w-[80%] space-y-2">
		<!-- Rich card (if present) -->
		{#if hasCard && message.toolResult}
			<div in:scale={{ start: 0.98, duration: 220, easing: cubicOut }}>
				{#if message.toolResult.type === 'availability'}
					{#if Array.isArray((message.toolResult.data as any)?.results)}
						<TeamAvailabilityCard data={message.toolResult.data as any} {onSlotClick} />
					{:else}
						<AvailabilityCard data={message.toolResult.data as any} {onSlotClick} />
					{/if}
				{:else if message.toolResult.type === 'booking'}
					<BookingCard data={message.toolResult.data as any} />
				{:else if message.toolResult.type === 'time_entry'}
					<TimeEntryCard data={message.toolResult.data as any} />
				{/if}
			</div>
		{/if}

		<!-- Text content bubble -->
		{#if message.content.trim()}
			<div
				class="rounded-2xl px-4 py-3 {
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
		{/if}

		<!-- Suggestion pills -->
		{#if hasSuggestions && message.suggestions}
			<div class="flex flex-wrap gap-1.5" in:fade={{ duration: 180 }}>
				{#each message.suggestions as suggestion, i}
					<button
						class="px-3 py-1.5 rounded-full text-xs font-medium
						       glass border border-white/10
						       text-slate-300 hover:text-white
						       hover:border-amber-500/30 hover:bg-amber-500/10
						       transition-all cursor-pointer btn-press"
						onclick={() => onSuggestionClick?.(suggestion.action)}
						in:scale={{ start: 0.94, duration: 180, delay: Math.min(i * 24, 120), easing: cubicOut }}
					>
						{suggestion.label}
					</button>
				{/each}
			</div>
		{/if}
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
