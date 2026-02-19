<script lang="ts">
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	let {
		data,
		onSlotClick,
	}: {
		data: {
			user_email: string;
			date: string;
			day_of_week: string;
			busy_times: Array<{ subject?: string; start: string; end: string }>;
			free_slots: Array<{ start: string; end: string; duration_hours: number }>;
			total_events: number;
			is_completely_free: boolean;
		};
		onSlotClick?: (slot: string) => void;
	} = $props();

	let showTimeline = $state(false);

	function timeToHour(timeStr: string): number {
		const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
		if (!match) return 8;
		let hours = parseInt(match[1]);
		const minutes = parseInt(match[2]);
		const period = match[3].toUpperCase();
		if (period === 'PM' && hours !== 12) hours += 12;
		if (period === 'AM' && hours === 12) hours = 0;
		return hours + minutes / 60;
	}

	function timeToPercent(timeStr: string): number {
		const hour = timeToHour(timeStr);
		return ((hour - 8) / 9) * 100;
	}

	function getCurrentEasternHour(): number {
		const now = new Date();
		const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
		return eastern.getHours() + eastern.getMinutes() / 60;
	}

	function getCurrentTimePercent(): number {
		const hour = getCurrentEasternHour();
		return Math.max(0, Math.min(100, ((hour - 8) / 9) * 100));
	}

	function getCurrentTimeLabel(): string {
		const now = new Date();
		const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
		const h = eastern.getHours();
		const m = eastern.getMinutes();
		const period = h >= 12 ? 'p' : 'a';
		const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
		return `Now ${displayH}:${m.toString().padStart(2, '0')}${period}`;
	}

	function isToday(dateStr: string): boolean {
		const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
		return dateStr === today;
	}

	function personName(email: string): string {
		const name = email.split('@')[0].replace(/[._]/g, ' ');
		return name.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
	}

	function formatDate(dateStr: string): string {
		const [y, m, d] = dateStr.split('-').map(Number);
		const date = new Date(y, m - 1, d);
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	let showToday = $derived(isToday(data.date));
	let currentHour = $derived(getCurrentEasternHour());
	let currentTimePct = $derived(getCurrentTimePercent());
	let currentTimeLabel = $derived(getCurrentTimeLabel());

	let filteredBusyTimes = $derived(
		showToday ? data.busy_times.filter((e) => timeToHour(e.end) > currentHour) : data.busy_times
	);
	let filteredFreeSlots = $derived(
		showToday ? data.free_slots.filter((s) => timeToHour(s.end) > currentHour) : data.free_slots
	);

	let busyHours = $derived.by(() => {
		let total = 0;
		for (const event of filteredBusyTimes) {
			total += timeToHour(event.end) - timeToHour(event.start);
		}
		return Math.round(total * 10) / 10;
	});
	let freeHours = $derived.by(() => {
		let total = 0;
		for (const slot of filteredFreeSlots) { total += slot.duration_hours; }
		return Math.round(total * 10) / 10;
	});

	let status = $derived<'open' | 'partial' | 'booked'>(
		filteredFreeSlots.length === 0 ? 'booked'
			: filteredBusyTimes.length === 0 ? 'open' : 'partial'
	);

	let statusConfig = $derived({
		open:    { badge: 'Wide Open',  border: 'border-emerald-500/20', headerBg: 'bg-emerald-500/5', iconBg: 'bg-emerald-500/15', iconColor: 'text-emerald-400', badgeBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
		partial: { badge: 'Partial',    border: 'border-sky-500/20',     headerBg: 'bg-sky-500/5',     iconBg: 'bg-sky-500/15',     iconColor: 'text-sky-400',     badgeBg: 'bg-sky-500/15 text-sky-400 border-sky-500/25' },
		booked:  { badge: 'Fully Booked', border: 'border-rose-500/20', headerBg: 'bg-rose-500/5',    iconBg: 'bg-rose-500/15',    iconColor: 'text-rose-400',    badgeBg: 'bg-rose-500/15 text-rose-400 border-rose-500/25' },
	}[status]);

	let nextFreeAt = $derived.by(() => {
		if (!showToday || filteredFreeSlots.length === 0) return null;
		const inMeeting = filteredBusyTimes.some(
			(e) => timeToHour(e.start) <= currentHour && timeToHour(e.end) > currentHour
		);
		if (!inMeeting) return null;
		const next = filteredFreeSlots.find((s) => timeToHour(s.start) >= currentHour);
		return next ? next.start : null;
	});

	const timelineHours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
	function formatHourLabel(h: number): string {
		if (h === 12) return '12p';
		return h > 12 ? `${h - 12}p` : `${h}a`;
	}
</script>

<style>
	@keyframes pulse-now {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}
	.now-pulse { animation: pulse-now 2s ease-in-out infinite; }
</style>

<div class="card-enter glass rounded-2xl {statusConfig.border} overflow-hidden">
	<!-- Header -->
	<div class="px-5 py-3.5 border-b border-white/5 {statusConfig.headerBg}">
		<div class="flex items-center gap-3">
			<div class="w-8 h-8 rounded-lg {statusConfig.iconBg} flex items-center justify-center">
				<svg class="w-4 h-4 {statusConfig.iconColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
				</svg>
			</div>
			<div class="flex-1 min-w-0">
				<div class="flex items-center gap-2 flex-wrap">
					<h3 class="text-sm font-semibold text-white">{personName(data.user_email)}</h3>
					<span class="px-2 py-0.5 rounded-full text-[10px] font-medium border {statusConfig.badgeBg}">
						{statusConfig.badge}
					</span>
				</div>
				<div class="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
					<span>{data.day_of_week}, {formatDate(data.date)}</span>
					<span class="text-emerald-400"><strong>{freeHours}h</strong> free</span>
					<span class="text-rose-400"><strong>{busyHours}h</strong> busy</span>
					{#if nextFreeAt}
						<span class="text-amber-400">Next at {nextFreeAt}</span>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<!-- Free slots (always visible) -->
	{#if filteredFreeSlots.length > 0}
		<div class="px-5 py-3">
			<div class="flex flex-wrap gap-1.5">
				{#each filteredFreeSlots as slot, i}
					<button
						class="px-2.5 py-1 rounded-lg text-xs font-medium
						       bg-emerald-500/10 text-emerald-400 border border-emerald-500/20
						       hover:bg-emerald-500/20 hover:border-emerald-500/30
						       transition-all cursor-pointer btn-press"
						onclick={() => onSlotClick?.(`Book a meeting at ${slot.start}`)}
					>
						{slot.start} – {slot.end} <span class="text-emerald-500/50 ml-0.5">· {slot.duration_hours}h</span>
					</button>
				{/each}
			</div>
		</div>
	{:else}
		<div class="px-5 py-3">
			<div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/5 border border-rose-500/15">
				<svg class="w-3.5 h-3.5 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<p class="text-xs text-rose-300">No more availability {showToday ? 'today' : 'this day'}</p>
			</div>
		</div>
	{/if}

	<!-- Timeline (collapsible) -->
	<div class="border-t border-white/5">
		<button
			class="w-full px-5 py-2 flex items-center justify-between text-[11px] text-slate-500 hover:text-slate-400 transition-colors"
			onclick={() => showTimeline = !showTimeline}
			aria-expanded={showTimeline}
		>
			<span>{filteredBusyTimes.length} event{filteredBusyTimes.length !== 1 ? 's' : ''} · {showTimeline ? 'Hide' : 'Show'} timeline</span>
			<svg
				class="w-3.5 h-3.5 transition-transform duration-200 {showTimeline ? 'rotate-180' : ''}"
				fill="none" stroke="currentColor" viewBox="0 0 24 24"
			>
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
			</svg>
		</button>

		{#if showTimeline}
			<div class="px-5 pb-4" transition:slide={{ duration: 200, easing: cubicOut }}>
				<!-- Hour labels -->
				<div class="relative h-4 mb-1">
					{#each timelineHours as hour}
						{@const pct = ((hour - 8) / 9) * 100}
						<span class="absolute text-[9px] text-slate-500 -translate-x-1/2" style="left: {pct}%">
							{formatHourLabel(hour)}
						</span>
					{/each}
				</div>

				<!-- Timeline bar -->
				<div class="relative h-8 rounded-lg bg-white/5 border border-white/5 overflow-hidden">
					<div class="absolute inset-0 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-emerald-500/10"></div>

					{#each filteredBusyTimes as event}
						{@const left = Math.max(0, timeToPercent(event.start))}
						{@const right = Math.min(100, timeToPercent(event.end))}
						{@const width = right - left}
						<div
							class="absolute top-0 bottom-0 bg-rose-500/30 border-l border-r border-rose-500/40 rounded-sm hover:brightness-125 transition-all"
							style="left: {left}%; width: {width}%"
							title="{event.subject || 'Busy'}: {event.start} - {event.end}"
						>
							{#if width > 10}
								<span class="absolute inset-0 flex items-center justify-center text-[8px] text-rose-200 truncate px-1">
									{event.subject || 'Busy'}
								</span>
							{/if}
						</div>
					{/each}

					{#if showToday && currentTimePct >= 0 && currentTimePct <= 100}
						<div class="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 now-pulse" style="left: {currentTimePct}%">
							<div class="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-amber-400"></div>
							<div class="absolute -bottom-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[8px] text-amber-400 font-medium">
								{currentTimeLabel}
							</div>
						</div>
					{/if}
				</div>

				<!-- Legend -->
				<div class="flex items-center gap-3 mt-2 text-[9px] text-slate-500">
					<div class="flex items-center gap-1">
						<div class="w-2 h-2 rounded bg-rose-500/30 border border-rose-500/40"></div> Busy
					</div>
					<div class="flex items-center gap-1">
						<div class="w-2 h-2 rounded bg-emerald-500/20 border border-emerald-500/30"></div> Free
					</div>
					{#if showToday}
						<div class="flex items-center gap-1">
							<div class="w-2 h-0.5 rounded bg-amber-400"></div> Now
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
