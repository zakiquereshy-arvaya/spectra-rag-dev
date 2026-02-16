<script lang="ts">
	let {
		data,
	}: {
		data: {
			subject: string;
			date_formatted: string;
			day_of_week: string;
			start_time: string;
			end_time: string;
			teams_link?: string | null;
			sender_name: string;
			sender_email?: string;
			attendees?: string[];
		};
	} = $props();

	// Get initials for avatar
	function getInitials(name: string): string {
		return name
			.split(' ')
			.map((w) => w[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}
</script>

<div class="card-enter glass rounded-2xl border border-emerald-500/20 overflow-hidden">
	<!-- Header with checkmark -->
	<div class="px-5 py-4 border-b border-white/5 bg-emerald-500/5">
		<div class="flex items-center gap-3">
			<div class="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center">
				<svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
			</div>
			<div>
				<h3 class="text-sm font-semibold text-white">Meeting Booked</h3>
				<p class="text-xs text-emerald-400/70">Calendar invite sent</p>
			</div>
		</div>
	</div>

	<!-- Meeting details -->
	<div class="px-5 py-4 space-y-3">
		<!-- Title -->
		<h4 class="text-base font-bold text-white">{data.subject}</h4>

		<!-- Date & time -->
		<div class="flex items-center gap-2 text-sm text-slate-300">
			<svg class="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
			</svg>
			<span>{data.day_of_week}, {data.date_formatted}</span>
		</div>

		<div class="flex items-center gap-2 text-sm text-slate-300">
			<svg class="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
			<span>{data.start_time} – {data.end_time} ET</span>
		</div>

		<!-- Attendees -->
		<div class="flex items-center gap-2">
			<svg class="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
			</svg>
			<div class="flex items-center gap-1.5">
				<!-- Organizer -->
				<div
					class="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-[9px] font-bold text-amber-400"
					title="{data.sender_name} (organizer)"
				>
					{getInitials(data.sender_name)}
				</div>
				{#if data.attendees && data.attendees.length > 0}
					{#each data.attendees.slice(0, 4) as attendee}
						<div
							class="w-6 h-6 rounded-full bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-[9px] font-bold text-sky-400"
							title={attendee}
						>
							{getInitials(attendee.split('@')[0].replace(/[._]/g, ' '))}
						</div>
					{/each}
					{#if data.attendees.length > 4}
						<span class="text-xs text-slate-500 ml-1">+{data.attendees.length - 4}</span>
					{/if}
				{/if}
			</div>
		</div>

		<!-- Teams link -->
		{#if data.teams_link}
			<a
				href={data.teams_link}
				target="_blank"
				rel="noopener noreferrer"
				class="flex items-center gap-2 px-4 py-2.5 rounded-xl
				       bg-[#4B53BC]/15 border border-[#4B53BC]/25
				       hover:bg-[#4B53BC]/25 hover:border-[#4B53BC]/35
				       transition-all group mt-1"
			>
				<svg class="w-4 h-4 text-[#7B83EB]" viewBox="0 0 24 24" fill="currentColor">
					<path d="M19.3 8.9h-4.2c-.4 0-.7.3-.7.7v4.2c0 1.1.4 2 1.2 2.7.8.7 1.7 1 2.8 1 1 0 2-.4 2.7-1.1.7-.7 1.1-1.6 1.1-2.7v-3.7c0-.6-.2-1-.6-1.5-.3-.4-.8-.6-1.3-.6h-1zM20 6.5c.8 0 1.5-.7 1.5-1.5S20.8 3.5 20 3.5 18.5 4.2 18.5 5 19.2 6.5 20 6.5zM14 7c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-1 1.5H7.1c-.5 0-1 .2-1.3.6-.4.4-.5.9-.5 1.4v5.4c0 1.4.5 2.6 1.5 3.5 1 1 2.2 1.4 3.6 1.4 1.4 0 2.6-.5 3.5-1.4 1-1 1.4-2.1 1.4-3.5V9.2c0-.5-.2-.9-.5-1.2-.4-.3-.8-.5-1.3-.5H13z"/>
				</svg>
				<span class="text-sm font-medium text-[#7B83EB] group-hover:text-[#9BA3FF]">
					Join Teams Meeting
				</span>
				<svg class="w-3.5 h-3.5 text-[#7B83EB]/60 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
				</svg>
			</a>
		{/if}
	</div>
</div>
