<script lang="ts">
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	let {
		toolName,
		serverLabel,
		args,
		isProcessing = false,
		onApprove,
		onAlwaysAllow,
		onDeny,
	}: {
		toolName: string;
		serverLabel: string;
		args: Record<string, unknown>;
		isProcessing?: boolean;
		onApprove: () => void;
		onAlwaysAllow: () => void;
		onDeny: () => void;
	} = $props();

	let expanded = $state(false);

	function friendlyToolName(name: string): string {
		return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
	}

	function friendlyServerLabel(label: string): string {
		return label.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
	}

	let argEntries = $derived(Object.entries(args).filter(([, v]) => v !== null && v !== undefined));
</script>

<div
	class="card-enter glass rounded-2xl border border-red-500/25 overflow-hidden"
	in:fly={{ y: 12, duration: 280, easing: cubicOut }}
>
	<!-- Header -->
	<div class="px-5 py-4 border-b border-white/5 bg-red-500/5">
		<div class="flex items-center gap-3">
			<div class="w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center">
				<svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
				</svg>
			</div>
			<div class="flex-1 min-w-0">
				<h3 class="text-sm font-semibold text-white">Tool Approval Required</h3>
				<p class="text-xs text-red-400/70">{friendlyServerLabel(serverLabel)} wants to run a tool</p>
			</div>
		</div>
	</div>

	<!-- Tool details -->
	<div class="px-5 py-4 space-y-3">
		<div class="flex items-center gap-2">
			<svg class="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
			</svg>
			<span class="text-sm font-medium text-white">{friendlyToolName(toolName)}</span>
			<span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-500/10 text-slate-400 border border-slate-500/20">
				{toolName}
			</span>
		</div>

		{#if argEntries.length > 0}
			<button
				class="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-300 transition-colors"
				onclick={() => expanded = !expanded}
			>
				<svg
					class="w-3.5 h-3.5 transition-transform {expanded ? 'rotate-90' : ''}"
					fill="none" stroke="currentColor" viewBox="0 0 24 24"
				>
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				</svg>
				{expanded ? 'Hide' : 'Show'} parameters ({argEntries.length})
			</button>

			{#if expanded}
				<div class="rounded-lg bg-black/20 border border-white/5 p-3 space-y-1.5">
					{#each argEntries as [key, value]}
						<div class="flex gap-2 text-xs">
							<span class="text-slate-500 font-mono flex-shrink-0">{key}:</span>
							<span class="text-slate-300 break-all">
								{typeof value === 'object' ? JSON.stringify(value) : String(value)}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>

	<!-- Action buttons -->
	<div class="px-5 py-3 border-t border-white/5 flex items-center gap-2">
		{#if isProcessing}
			<div class="flex items-center gap-2 text-xs text-slate-400">
				<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
				</svg>
				Running tool...
			</div>
		{:else}
			<button
				onclick={onApprove}
				class="px-4 py-2 text-xs font-medium rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 text-white
				       hover:from-amber-400 hover:to-orange-500 transition-all shadow-lg shadow-amber-500/20 btn-press"
			>
				Allow Once
			</button>
			<button
				onclick={onAlwaysAllow}
				class="px-4 py-2 text-xs font-medium rounded-lg glass border border-amber-500/30 text-amber-300
				       hover:bg-amber-500/10 hover:border-amber-500/50 transition-all btn-press"
			>
				Always Allow
			</button>
			<button
				onclick={onDeny}
				class="px-4 py-2 text-xs font-medium rounded-lg glass border border-red-500/20 text-red-400
				       hover:bg-red-500/10 hover:border-red-500/40 transition-all btn-press ml-auto"
			>
				Deny
			</button>
		{/if}
	</div>
</div>
