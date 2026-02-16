<script lang="ts">
	let {
		data,
	}: {
		data: {
			customer_name: string;
			employee_name: string;
			hours: number;
			tasks_completed: string;
			entry_date: string;
			billable: boolean;
		};
	} = $props();

	let expanded = $state(false);

	// Format date
	function formatDate(dateStr: string): string {
		const [y, m, d] = dateStr.split('-').map(Number);
		const date = new Date(y, m - 1, d);
		return date.toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			year: 'numeric',
		});
	}

	// Check if description is long
	let isLongDescription = $derived(data.tasks_completed.length > 120);
	let displayDescription = $derived(
		isLongDescription && !expanded
			? data.tasks_completed.slice(0, 120) + '...'
			: data.tasks_completed
	);
</script>

<div class="card-enter glass rounded-2xl border border-teal-500/20 overflow-hidden">
	<!-- Header -->
	<div class="px-5 py-4 border-b border-white/5 bg-teal-500/5">
		<div class="flex items-center gap-3">
			<div class="w-9 h-9 rounded-xl bg-teal-500/15 flex items-center justify-center">
				<svg class="w-5 h-5 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
			</div>
			<div>
				<h3 class="text-sm font-semibold text-white">Time Entry Submitted</h3>
				<p class="text-xs text-teal-400/70">Successfully logged</p>
			</div>
		</div>
	</div>

	<!-- Details -->
	<div class="px-5 py-4">
		<div class="flex items-start justify-between gap-4">
			<!-- Left: customer, description, date -->
			<div class="space-y-2 flex-1 min-w-0">
				<!-- Customer -->
				<div class="flex items-center gap-2">
					<svg class="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
					</svg>
					<span class="text-sm font-medium text-white">{data.customer_name}</span>
				</div>

				<!-- Description -->
				<div class="text-sm text-slate-300">
					<p class="whitespace-pre-wrap">{displayDescription}</p>
					{#if isLongDescription}
						<button
							class="text-xs text-teal-400 hover:text-teal-300 mt-1 transition-colors"
							onclick={() => expanded = !expanded}
						>
							{expanded ? 'Show less' : 'Show more'}
						</button>
					{/if}
				</div>

				<!-- Date -->
				<div class="flex items-center gap-2 text-xs text-slate-500">
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
					</svg>
					{formatDate(data.entry_date)}
					{#if data.billable}
						<span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
							Billable
						</span>
					{:else}
						<span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">
							Non-billable
						</span>
					{/if}
				</div>
			</div>

			<!-- Right: hours -->
			<div class="text-right flex-shrink-0">
				<div class="text-3xl font-bold text-teal-400">{data.hours}</div>
				<div class="text-xs text-slate-500 mt-0.5">hour{data.hours !== 1 ? 's' : ''}</div>
			</div>
		</div>
	</div>
</div>
