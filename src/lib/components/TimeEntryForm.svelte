<!-- TimeEntryForm.svelte - Time Entry Form for Billi -->
<script lang="ts">
	interface Props {
		onsubmit: (data: { customer: string; project: string; description: string; hours: number; entryDate: string }) => void;
		oncancel: () => void;
		initialHours?: number;
		initialDate?: string;
	}

	let { onsubmit, oncancel, initialHours = 0, initialDate }: Props = $props();

	// Today in Eastern Time (YYYY-MM-DD)
	const todayEastern = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

	// Form state
	let selectedCustomer = $state('');
	let selectedProject = $state('');
	let description = $state('');
	let hours = $state<number | null>(initialHours > 0 ? initialHours : null);
	let entryDate = $state(initialDate || todayEastern);
	let isSubmitting = $state(false);
	let customProject = $state('');

	// Customer options
	const customers = [
		{ value: 'Arvaya', label: 'Arvaya' },
		{ value: 'Infrastructure Consulting & Engineering', label: 'Infrastructure Consulting & Engineering' },
	];

	// Project options per customer
	const projectsByCustomer: Record<string, { value: string; label: string }[]> = {
		'Arvaya': [
			{ value: 'Business Development', label: 'Business Development' },
			{ value: 'Marketing', label: 'Marketing' },
			{ value: 'Billi', label: 'Billi' },
			{ value: 'General Internal Meetings', label: 'General Internal Meetings' },
			{ value: 'other', label: 'Other (specify below)' },
		],
		'Infrastructure Consulting & Engineering': [
			{ value: 'Open Asset DAM', label: 'Open Asset DAM' },
			{ value: 'ICE Monday.com', label: 'ICE Monday.com' },
			{ value: 'VP/Zistemo', label: 'VP/Zistemo' },
			{ value: 'AI POWERED LLM', label: 'AI POWERED LLM' },
			{ value: 'General/Meetings', label: 'General/Meetings (Provide description)' },
		],
	};

	// Get available projects based on selected customer
	let availableProjects = $derived(
		selectedCustomer ? projectsByCustomer[selectedCustomer] || [] : []
	);

	// Reset project when customer changes
	$effect(() => {
		if (selectedCustomer) {
			selectedProject = '';
			customProject = '';
		}
	});

	// Check if form is valid
	let isValid = $derived(
		selectedCustomer !== '' &&
		selectedProject !== '' &&
		(selectedProject !== 'other' || customProject.trim() !== '') &&
		description.trim() !== '' &&
		hours !== null &&
		hours > 0
	);

	// Handle form submission
	async function handleSubmit() {
		if (!isValid || isSubmitting || hours === null) return;

		isSubmitting = true;

		const finalProject = selectedProject === 'other' ? customProject.trim() : selectedProject;

		onsubmit({
			customer: selectedCustomer,
			project: finalProject,
			description: description.trim(),
			hours: hours,
			entryDate: entryDate,
		});
	}

	function handleCancel() {
		oncancel();
	}
</script>

<div class="glass rounded-2xl p-6 max-w-lg mx-auto animate-fade-in">
	<div class="flex items-center gap-3 mb-6">
		<div class="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
			<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
			</svg>
		</div>
		<div>
			<h2 class="text-lg font-bold text-white">Log Time Entry</h2>
			<p class="text-xs text-slate-400">Fill out the details below</p>
		</div>
	</div>

	<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-5">
		<!-- Customer Dropdown -->
		<div>
			<label for="customer" class="block text-sm font-medium text-slate-300 mb-2">
				Customer <span class="text-red-400">*</span>
			</label>
			<select
				id="customer"
				bind:value={selectedCustomer}
				class="w-full px-4 py-3 glass-input rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 appearance-none cursor-pointer"
				disabled={isSubmitting}
			>
				<option value="" disabled>Select a customer...</option>
				{#each customers as customer}
					<option value={customer.value}>{customer.label}</option>
				{/each}
			</select>
		</div>

		<!-- Date -->
		<div>
			<label for="entryDate" class="block text-sm font-medium text-slate-300 mb-2">
				Date
			</label>
			<input
				id="entryDate"
				type="date"
				bind:value={entryDate}
				max={todayEastern}
				class="w-full px-4 py-3 glass-input rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
				disabled={isSubmitting}
			/>
			{#if entryDate !== todayEastern}
				<p class="text-xs text-amber-400 mt-1">Logging for a previous day</p>
			{/if}
		</div>

		<!-- Project Dropdown (conditional) -->
		{#if selectedCustomer}
			<div class="animate-fade-in">
				<label for="project" class="block text-sm font-medium text-slate-300 mb-2">
					Project <span class="text-red-400">*</span>
				</label>
				<select
					id="project"
					bind:value={selectedProject}
					class="w-full px-4 py-3 glass-input rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 appearance-none cursor-pointer"
					disabled={isSubmitting}
				>
					<option value="" disabled>Select a project...</option>
					{#each availableProjects as project}
						<option value={project.value}>{project.label}</option>
					{/each}
				</select>
			</div>
		{/if}

		<!-- Custom Project Input (for Arvaya "Other" option) -->
		{#if selectedProject === 'other'}
			<div class="animate-fade-in">
				<label for="customProject" class="block text-sm font-medium text-slate-300 mb-2">
					Specify Project <span class="text-red-400">*</span>
				</label>
				<input
					id="customProject"
					type="text"
					bind:value={customProject}
					placeholder="Enter project name..."
					class="w-full px-4 py-3 glass-input rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
					disabled={isSubmitting}
				/>
			</div>
		{/if}

		<!-- Hours -->
		{#if selectedProject}
			<div class="animate-fade-in">
				<label for="hours" class="block text-sm font-medium text-slate-300 mb-2">
					Hours <span class="text-red-400">*</span>
				</label>
				<input
					id="hours"
					type="number"
					step="0.25"
					min="0.25"
					max="24"
					bind:value={hours}
					placeholder="e.g., 2.5"
					class="w-full px-4 py-3 glass-input rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
					disabled={isSubmitting}
				/>
			</div>
		{/if}

		<!-- Description -->
		{#if selectedProject}
			<div class="animate-fade-in">
				<label for="description" class="block text-sm font-medium text-slate-300 mb-2">
					Description <span class="text-red-400">*</span>
				</label>
				<textarea
					id="description"
					bind:value={description}
					placeholder="What did you work on?"
					rows="3"
					class="w-full px-4 py-3 glass-input rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-none"
					disabled={isSubmitting}
				></textarea>
			</div>
		{/if}

		<!-- Buttons -->
		<div class="flex gap-3 pt-2">
			<button
				type="button"
				onclick={handleCancel}
				class="flex-1 px-4 py-3 glass text-slate-300 rounded-xl font-medium hover:text-white hover:border-slate-500/50 transition-colors"
				disabled={isSubmitting}
			>
				Cancel
			</button>
			<button
				type="submit"
				disabled={!isValid || isSubmitting}
				class="flex-1 px-4 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl font-medium
				       hover:from-emerald-400 hover:to-teal-500
				       disabled:opacity-50 disabled:cursor-not-allowed
				       focus:outline-none focus:ring-2 focus:ring-emerald-500/50
				       transition-all shadow-lg shadow-emerald-500/20 btn-press"
			>
				{#if isSubmitting}
					<span class="flex items-center justify-center gap-2">
						<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						Submitting...
					</span>
				{:else}
					Submit Time Entry
				{/if}
			</button>
		</div>
	</form>
</div>

<style>
	.animate-fade-in {
		animation: fadeIn 0.2s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Custom dropdown arrow */
	select {
		background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
		background-position: right 0.75rem center;
		background-repeat: no-repeat;
		background-size: 1.5em 1.5em;
		padding-right: 2.5rem;
	}

	select option {
		background-color: #1a1a2e;
		color: white;
	}
</style>
