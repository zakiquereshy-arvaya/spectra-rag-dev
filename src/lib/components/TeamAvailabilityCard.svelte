<script lang="ts">
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	type AvailabilityResult = {
		user_email: string;
		date: string;
		day_of_week: string;
		busy_times: Array<{ subject?: string; start: string; end: string }>;
		free_slots: Array<{ start: string; end: string; duration_hours: number }>;
	};

	let {
		data,
		onSlotClick,
	}: {
		data: { results: AvailabilityResult[] };
		onSlotClick?: (slot: string) => void;
	} = $props();

	let expandedPerson = $state<number | null>(null);

	function toggle(i: number) {
		expandedPerson = expandedPerson === i ? null : i;
	}

	function personName(email: string): string {
		const raw = email?.split('@')[0] || email;
		return raw
			.replace(/([a-z])([A-Z])/g, '$1 $2')
			.replace(/[._]/g, ' ')
			.split(' ')
			.filter(Boolean)
			.map((part) => part[0].toUpperCase() + part.slice(1))
			.join(' ');
	}

	function totalFreeHours(slots: Array<{ duration_hours: number }>): number {
		return Math.round(slots.reduce((sum, slot) => sum + (slot.duration_hours || 0), 0) * 10) / 10;
	}

	function statusFor(result: AvailabilityResult): 'open' | 'partial' | 'booked' {
		if (result.free_slots.length === 0) return 'booked';
		if (result.busy_times.length === 0) return 'open';
		return 'partial';
	}

	const statusStyles = {
		open:    { dot: 'bg-emerald-400', badge: 'Wide Open',  badgeCls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
		partial: { dot: 'bg-amber-400',   badge: 'Partial',    badgeCls: 'bg-amber-500/15 text-amber-400 border-amber-500/25' },
		booked:  { dot: 'bg-rose-400',    badge: 'Fully Booked', badgeCls: 'bg-rose-500/15 text-rose-400 border-rose-500/25' },
	};

	function bestSlot(slots: AvailabilityResult['free_slots']): string | null {
		if (slots.length === 0) return null;
		const longest = [...slots].sort((a, b) => b.duration_hours - a.duration_hours)[0];
		return `${longest.start} - ${longest.end}`;
	}
</script>

<div class="card-enter glass rounded-2xl border border-sky-500/20 overflow-hidden">
	<!-- Header -->
	<div class="px-5 py-3.5 border-b border-white/5 bg-sky-500/5 flex items-center justify-between">
		<div class="flex items-center gap-3">
			<div class="w-8 h-8 rounded-lg bg-sky-500/15 flex items-center justify-center">
				<svg class="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
				</svg>
			</div>
			<div>
				<h3 class="text-sm font-semibold text-white">Team Availability</h3>
				<p class="text-[11px] text-slate-500">{data.results.length} people · tap to expand</p>
			</div>
		</div>
	</div>

	<!-- Compact rows -->
	<div class="divide-y divide-white/5">
		{#each data.results as result, i}
			{@const status = statusFor(result)}
			{@const styles = statusStyles[status]}
			{@const freeHrs = totalFreeHours(result.free_slots)}
			{@const isOpen = expandedPerson === i}
			{@const best = bestSlot(result.free_slots)}

			<div>
				<!-- Summary row -->
				<button
					class="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-white/[0.02] transition-colors"
					onclick={() => toggle(i)}
					aria-expanded={isOpen}
				>
					<!-- Status dot -->
					<div class="w-2.5 h-2.5 rounded-full {styles.dot} flex-shrink-0"></div>

					<!-- Name -->
					<span class="text-sm font-medium text-white flex-1 truncate">{personName(result.user_email)}</span>

					<!-- Quick info -->
					<div class="flex items-center gap-2 flex-shrink-0">
						{#if best && !isOpen}
							<span class="hidden sm:inline text-[11px] text-slate-500 truncate max-w-[120px]">Best: {best}</span>
						{/if}
						<span class="px-2 py-0.5 rounded-full text-[10px] font-medium border {styles.badgeCls}">
							{freeHrs > 0 ? `${freeHrs}h free` : styles.badge}
						</span>
						<svg
							class="w-4 h-4 text-slate-500 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}"
							fill="none" stroke="currentColor" viewBox="0 0 24 24"
						>
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
						</svg>
					</div>
				</button>

				<!-- Expanded detail -->
				{#if isOpen}
					<div
						class="px-5 pb-4 pl-10"
						transition:slide={{ duration: 200, easing: cubicOut }}
					>
						<p class="text-[11px] text-slate-500 mb-2">{result.day_of_week}, {result.date} · {result.busy_times.length} event{result.busy_times.length !== 1 ? 's' : ''}</p>

						{#if result.free_slots.length > 0}
							<p class="text-xs text-slate-400 mb-1.5">Available slots:</p>
							<div class="flex flex-wrap gap-1.5">
								{#each result.free_slots as slot}
									<button
										class="px-2.5 py-1 rounded-lg text-xs font-medium
										       bg-emerald-500/10 text-emerald-400 border border-emerald-500/20
										       hover:bg-emerald-500/20 hover:border-emerald-500/30
										       transition-all btn-press"
										onclick={() => onSlotClick?.(`Book a meeting with ${personName(result.user_email)} at ${slot.start}`)}
									>
										{slot.start} - {slot.end}
										<span class="text-emerald-500/50 ml-0.5">· {slot.duration_hours}h</span>
									</button>
								{/each}
							</div>
						{:else}
							<div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/5 border border-rose-500/15">
								<svg class="w-3.5 h-3.5 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
								<p class="text-xs text-rose-300">No availability this day</p>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>
