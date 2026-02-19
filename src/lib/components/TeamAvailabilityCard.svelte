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

	type Interval = { start: number; end: number };
	type RecommendedSlot = {
		start: string;
		end: string;
		durationHours: number;
		availablePeopleCount: number;
		availableNames: string[];
	};

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

	function timeToMinutes(timeStr: string): number {
		const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
		if (!match) return 0;
		let hours = Number.parseInt(match[1], 10);
		const minutes = Number.parseInt(match[2], 10);
		const period = match[3].toUpperCase();
		if (period === 'PM' && hours !== 12) hours += 12;
		if (period === 'AM' && hours === 12) hours = 0;
		return hours * 60 + minutes;
	}

	function minutesToTime(minutes: number): string {
		const total = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
		let hours = Math.floor(total / 60);
		const mins = total % 60;
		const period = hours >= 12 ? 'PM' : 'AM';
		if (hours === 0) hours = 12;
		else if (hours > 12) hours -= 12;
		return `${hours}:${mins.toString().padStart(2, '0')} ${period}`;
	}

	function toIntervals(slots: AvailabilityResult['free_slots']): Interval[] {
		return slots
			.map((slot) => ({ start: timeToMinutes(slot.start), end: timeToMinutes(slot.end) }))
			.filter((slot) => slot.end > slot.start)
			.sort((a, b) => a.start - b.start);
	}

	function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
		const out: Interval[] = [];
		let i = 0;
		let j = 0;
		while (i < a.length && j < b.length) {
			const start = Math.max(a[i].start, b[j].start);
			const end = Math.min(a[i].end, b[j].end);
			if (end > start) out.push({ start, end });
			if (a[i].end < b[j].end) i++;
			else j++;
		}
		return out;
	}

	function getAllCommonIntervals(results: AvailabilityResult[]): Interval[] {
		if (results.length === 0) return [];
		let common = toIntervals(results[0].free_slots);
		for (let i = 1; i < results.length; i++) {
			common = intersectIntervals(common, toIntervals(results[i].free_slots));
			if (common.length === 0) break;
		}
		return common.filter((slot) => slot.end - slot.start >= 30);
	}

	function getBestOverlapSegments(results: AvailabilityResult[]): Array<{ start: number; end: number; ids: number[] }> {
		const events: Array<{ t: number; delta: number; id: number }> = [];
		results.forEach((person, id) => {
			for (const slot of toIntervals(person.free_slots)) {
				events.push({ t: slot.start, delta: 1, id });
				events.push({ t: slot.end, delta: -1, id });
			}
		});

		if (events.length === 0) return [];
		events.sort((a, b) => (a.t === b.t ? a.delta - b.delta : a.t - b.t));

		const active = new Set<number>();
		const segments: Array<{ start: number; end: number; ids: number[] }> = [];
		let prevTime = events[0].t;
		let idx = 0;

		while (idx < events.length) {
			const currentTime = events[idx].t;
			if (currentTime > prevTime && active.size > 0) {
				segments.push({ start: prevTime, end: currentTime, ids: [...active].sort((a, b) => a - b) });
			}

			while (idx < events.length && events[idx].t === currentTime) {
				const e = events[idx];
				if (e.delta < 0) active.delete(e.id);
				else active.add(e.id);
				idx++;
			}
			prevTime = currentTime;
		}

		const merged: Array<{ start: number; end: number; ids: number[] }> = [];
		for (const seg of segments.filter((s) => s.end - s.start >= 30)) {
			const last = merged[merged.length - 1];
			const sameIds =
				last &&
				last.ids.length === seg.ids.length &&
				last.ids.every((id, i) => id === seg.ids[i]);
			if (last && sameIds && last.end === seg.start) {
				last.end = seg.end;
			} else {
				merged.push({ ...seg });
			}
		}
		return merged;
	}

	function toRecommendedSlots(
		segments: Array<{ start: number; end: number; ids: number[] }>,
		results: AvailabilityResult[]
	): RecommendedSlot[] {
		return segments.map((seg) => ({
			start: minutesToTime(seg.start),
			end: minutesToTime(seg.end),
			durationHours: Math.round(((seg.end - seg.start) / 60) * 10) / 10,
			availablePeopleCount: seg.ids.length,
			availableNames: seg.ids.map((id) => personName(results[id].user_email)),
		}));
	}

	let allCommonRecommended = $derived.by(() => {
		const intervals = getAllCommonIntervals(data.results).map((slot) => ({
			start: slot.start,
			end: slot.end,
			ids: data.results.map((_, i) => i),
		}));
		return toRecommendedSlots(intervals, data.results)
			.sort((a, b) => b.durationHours - a.durationHours)
			.slice(0, 5);
	});

	let bestAlternatives = $derived.by(() => {
		const minPeople = Math.min(2, data.results.length);
		return toRecommendedSlots(getBestOverlapSegments(data.results), data.results)
			.filter((slot) => slot.availablePeopleCount >= minPeople)
			.sort((a, b) => {
				if (b.availablePeopleCount !== a.availablePeopleCount) {
					return b.availablePeopleCount - a.availablePeopleCount;
				}
				if (b.durationHours !== a.durationHours) {
					return b.durationHours - a.durationHours;
				}
				return timeToMinutes(a.start) - timeToMinutes(b.start);
			})
			.slice(0, 6);
	});
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

	<!-- Recommended common slots -->
	<div class="px-5 py-3 border-b border-white/5 bg-white/[0.02]">
		<div class="flex items-center justify-between gap-3 mb-2">
			<p class="text-xs font-semibold text-slate-300">Recommended common times</p>
			<span class="text-[10px] text-slate-500">{data.results.length} participants</span>
		</div>

		{#if allCommonRecommended.length > 0}
			<p class="text-[11px] text-emerald-300 mb-2">Everyone is free in these windows:</p>
			<div class="flex flex-wrap gap-1.5">
				{#each allCommonRecommended as slot}
					<button
						class="px-2.5 py-1 rounded-lg text-xs font-medium
						       bg-emerald-500/10 text-emerald-400 border border-emerald-500/20
						       hover:bg-emerald-500/20 hover:border-emerald-500/30 transition-all btn-press"
						title="Available: {slot.availableNames.join(', ')}"
						onclick={() => onSlotClick?.(`Book a meeting with ${slot.availableNames.join(', ')} at ${slot.start}`)}
					>
						{slot.start} - {slot.end}
						<span class="text-emerald-500/60 ml-0.5">· {slot.durationHours}h · all</span>
					</button>
				{/each}
			</div>
		{:else if bestAlternatives.length > 0}
			<p class="text-[11px] text-amber-300 mb-2">No single slot fits everyone. Best overlap options:</p>
			<div class="flex flex-wrap gap-1.5">
				{#each bestAlternatives as slot}
					<button
						class="px-2.5 py-1 rounded-lg text-xs font-medium
						       bg-amber-500/10 text-amber-400 border border-amber-500/20
						       hover:bg-amber-500/20 hover:border-amber-500/30 transition-all btn-press"
						title="Available: {slot.availableNames.join(', ')}"
						onclick={() => onSlotClick?.(`Book a meeting with ${slot.availableNames.join(', ')} at ${slot.start}`)}
					>
						{slot.start} - {slot.end}
						<span class="text-amber-500/60 ml-0.5">· {slot.availablePeopleCount}/{data.results.length}</span>
					</button>
				{/each}
			</div>
		{:else}
			<div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/5 border border-rose-500/15">
				<svg class="w-3.5 h-3.5 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<p class="text-xs text-rose-300">No meaningful overlap found across these calendars.</p>
			</div>
		{/if}
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
