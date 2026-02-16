<script lang="ts">
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
		data: {
			results: AvailabilityResult[];
		};
		onSlotClick?: (slot: string) => void;
	} = $props();

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
</script>

<div class="card-enter glass rounded-2xl border border-sky-500/20 overflow-hidden">
	<div class="px-5 py-4 border-b border-white/5 bg-sky-500/5">
		<h3 class="text-sm font-semibold text-white">Team Availability</h3>
		<p class="text-xs text-slate-400">Compared across {data.results.length} people</p>
	</div>

	<div class="divide-y divide-white/5">
		{#each data.results as result}
			{@const freeHours = totalFreeHours(result.free_slots)}
			<div class="px-5 py-3">
				<div class="flex items-center justify-between gap-4">
					<div>
						<p class="text-sm text-white font-medium">{personName(result.user_email)}</p>
						<p class="text-[11px] text-slate-500">{result.day_of_week}, {result.date}</p>
					</div>
					<div class="text-right">
						<p class="text-xs {freeHours > 0 ? 'text-emerald-400' : 'text-rose-400'}">
							{freeHours > 0 ? `${freeHours}h free` : 'No open slots'}
						</p>
						<p class="text-[11px] text-slate-500">{result.busy_times.length} event{result.busy_times.length !== 1 ? 's' : ''}</p>
					</div>
				</div>

				{#if result.free_slots.length > 0}
					<div class="mt-2 -mx-1 overflow-x-auto pb-1">
						<div class="flex min-w-max gap-1.5 px-1">
							{#each result.free_slots as slot}
								<button
									class="whitespace-nowrap px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all btn-press"
									onclick={() => onSlotClick?.(`Book a meeting with ${personName(result.user_email)} at ${slot.start}`)}
								>
									{slot.start} - {slot.end}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>
