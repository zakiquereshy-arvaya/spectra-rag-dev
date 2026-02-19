<!-- src/lib/components/MessageList.svelte -->
<script lang="ts">
	import MessageBubble from './MessageBubble.svelte';
	import type { ChatMessage } from '../api/chat';
	import { fade, fly, scale } from 'svelte/transition';
	import { cubicOut, quintOut } from 'svelte/easing';

	interface Props {
		messages: ChatMessage[];
		isLoading?: boolean;
		toolStatus?: { tool: string; label: string } | null;
		userName?: string;
		onQuickAction?: (action: string) => void;
		onSlotClick?: (text: string) => void;
		onSuggestionClick?: (action: string) => void;
		onPatchNotesClick?: () => void;
	}

	let {
		messages,
		isLoading = false,
		toolStatus = null,
		userName = '',
		onQuickAction,
		onSlotClick,
		onSuggestionClick,
		onPatchNotesClick,
	}: Props = $props();

	let containerElement: HTMLDivElement;
	let shouldAutoScroll = $state(true);
	const AUTO_SCROLL_THRESHOLD = 120;

	function getDistanceFromBottom(element: HTMLDivElement): number {
		return element.scrollHeight - element.scrollTop - element.clientHeight;
	}

	function updateAutoScrollPreference() {
		if (!containerElement) return;
		shouldAutoScroll = getDistanceFromBottom(containerElement) < AUTO_SCROLL_THRESHOLD;
	}

	function handleScroll() {
		updateAutoScrollPreference();
	}

	$effect.pre(() => {
		messages.length;
		isLoading;
		toolStatus?.label;
		updateAutoScrollPreference();
	});

	$effect(() => {
		messages.length;
		isLoading;
		toolStatus?.label;
		if (!containerElement || !shouldAutoScroll) return;
		requestAnimationFrame(() => {
			containerElement.scrollTo({
				top: containerElement.scrollHeight,
				behavior: isLoading ? 'auto' : 'smooth'
			});
		});
	});

	function getGreeting(): string {
		const hour = new Date().getHours();
		const name = userName ? `, ${userName.split(' ')[0]}` : '';
		if (hour < 12) return `Good morning${name}`;
		if (hour < 17) return `Good afternoon${name}`;
		return `Good evening${name}`;
	}

	let greeting = $derived.by(() => getGreeting());

	const quickActions = [
		{
			label: 'Log Time',
			icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
			color: 'emerald',
			action: 'log_time',
			description: 'Track hours for a project',
		},
		{
			label: 'Check Availability',
			icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
			color: 'sky',
			action: 'check_availability',
			description: 'See who\'s free today',
		},
		{
			label: 'Book Meeting',
			icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
			color: 'purple',
			action: 'book_meeting',
			description: 'Schedule a Teams meeting',
		},
		{
			label: 'Monday Updates',
			icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
			color: 'red',
			action: 'monday_updates',
			description: 'View action items & boards',
		},
	];

	const mondayExamples = [
		{ text: 'Show my action items', emoji: '📋' },
		{ text: 'What\'s on the AI LLM board?', emoji: '🤖' },
		{ text: 'Update status on my tasks', emoji: '✏️' },
		{ text: 'Show recent updates from Monday', emoji: '🔄' },
	];

	function getColorClasses(color: string): { bg: string; border: string; text: string; iconBg: string } {
		switch (color) {
			case 'emerald':
				return { bg: 'hover:bg-emerald-500/10', border: 'border-emerald-500/15 hover:border-emerald-500/30', text: 'text-emerald-400', iconBg: 'bg-emerald-500/10' };
			case 'sky':
				return { bg: 'hover:bg-sky-500/10', border: 'border-sky-500/15 hover:border-sky-500/30', text: 'text-sky-400', iconBg: 'bg-sky-500/10' };
			case 'purple':
				return { bg: 'hover:bg-purple-500/10', border: 'border-purple-500/15 hover:border-purple-500/30', text: 'text-purple-400', iconBg: 'bg-purple-500/10' };
			case 'amber':
				return { bg: 'hover:bg-amber-500/10', border: 'border-amber-500/15 hover:border-amber-500/30', text: 'text-amber-400', iconBg: 'bg-amber-500/10' };
			case 'red':
				return { bg: 'hover:bg-red-500/10', border: 'border-red-500/15 hover:border-red-500/30', text: 'text-red-400', iconBg: 'bg-red-500/10' };
			default:
				return { bg: 'hover:bg-white/5', border: 'border-white/10', text: 'text-white', iconBg: 'bg-white/5' };
		}
	}
</script>

<div
	bind:this={containerElement}
	onscroll={handleScroll}
	class="flex-1 overflow-y-auto px-4 py-4 space-y-2"
>
	{#if messages.length === 0}
		<!-- Welcome state with quick actions -->
		<div class="flex items-center justify-center h-full">
			<div class="text-center max-w-xl w-full glass-light rounded-3xl border border-white/10 px-5 py-8" in:fade={{ duration: 240 }}>
				<!-- Avatar -->
				<button
					type="button"
					class="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-amber-500/20 btn-press"
					onclick={() => onPatchNotesClick?.()}
					aria-label="Open Billi patch notes"
					title="Open Billi v1.2 patch notes"
				>
					<svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
					</svg>
				</button>
				<button
					type="button"
					class="text-xs text-amber-300/80 hover:text-amber-200 mb-3"
					onclick={() => onPatchNotesClick?.()}
				>
					View Billi v1.2 patch notes
				</button>

				<!-- Greeting -->
				<h2 class="text-xl font-bold text-white mb-1">{greeting}</h2>
				<p class="text-sm text-slate-400 mb-2">I'm Billi, your workspace assistant.</p>
				<p class="text-xs text-slate-500 mb-6">Calendar, meetings, time logging, and Monday.com -- all in one place.</p>

				<!-- Quick action grid -->
				<div class="grid grid-cols-2 gap-3 px-4 mb-6">
					{#each quickActions as action, i}
						{@const colors = getColorClasses(action.color)}
						<button
							class="glass rounded-xl p-4 text-left border {colors.border} {colors.bg}
							       transition-all cursor-pointer quick-action"
							onclick={() => onQuickAction?.(action.action)}
							in:fly={{ y: 12, duration: 300, delay: Math.min(i * 60, 240), easing: quintOut }}
						>
							<div class="w-8 h-8 rounded-lg {colors.iconBg} flex items-center justify-center mb-2.5">
								<svg class="w-4 h-4 {colors.text}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={action.icon} />
								</svg>
							</div>
							<div class="text-sm font-medium text-white">{action.label}</div>
							<div class="text-xs text-slate-500 mt-0.5">{action.description}</div>
						</button>
					{/each}
				</div>

				<!-- Monday tips -->
				<div class="px-4" in:fly={{ y: 10, duration: 300, delay: 320, easing: quintOut }}>
					<div class="glass rounded-xl border border-white/5 p-4 text-left">
						<p class="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2.5">Try asking Billi</p>
						<div class="grid grid-cols-2 gap-2">
							{#each mondayExamples as example, i}
								<button
									class="text-left px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white
									       hover:bg-white/5 transition-all btn-press"
									onclick={() => onQuickAction?.(example.text)}
									in:fly={{ y: 6, duration: 240, delay: 360 + i * 50, easing: quintOut }}
								>
									<span class="mr-1.5">{example.emoji}</span>{example.text}
								</button>
							{/each}
						</div>
					</div>
				</div>
			</div>
		</div>
	{:else}
		{#each messages as message, i (message.timestamp)}
			<MessageBubble {message} index={i} {onSlotClick} {onSuggestionClick} />
		{/each}
	{/if}

	{#if isLoading}
		<div class="mb-4 flex justify-start" in:fly={{ y: 8, duration: 260, easing: cubicOut }}>
			<div class="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center mr-3 mt-1 shadow-lg shadow-amber-500/20 avatar-thinking">
				<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
				</svg>
			</div>
			<div class="space-y-1.5">
				<div class="glass-light rounded-2xl">
					<div class="typing-indicator">
						<span></span>
						<span></span>
						<span></span>
					</div>
				</div>
				<div class="text-[11px] text-slate-500 pl-1">Billi is thinking...</div>
				{#if toolStatus}
					<div
						class="flex items-center gap-2 px-3 py-1.5 rounded-full glass border border-white/5 text-xs text-slate-400"
						in:scale={{ duration: 180, start: 0.92, easing: cubicOut }}
					>
						<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						{toolStatus.label}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
