<script lang="ts">
	import { fly, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { formatMessageWithMarkdown } from '$lib/utils/sanitize';

	let { content }: { content: string } = $props();

	interface ReportSection {
		title: string;
		body: string;
		icon: string;
		accent: string;
	}

	let collapsed = $state(true);

	function parseSections(raw: string): { intro: string; sections: ReportSection[]; metrics: Map<string, string> } {
		const lines = raw.split('\n');
		const sections: ReportSection[] = [];
		const metrics = new Map<string, string>();
		let intro = '';
		let currentTitle = '';
		let currentLines: string[] = [];
		let introComplete = false;

		const iconMap: Record<string, string> = {
			'key metrics': 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
			'recent updates': 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
			'risks': 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
			'blockers': 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636',
			'action items': 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
			'default': 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
		};

		const accentMap: Record<string, string> = {
			'key metrics': 'amber',
			'recent updates': 'sky',
			'risks': 'rose',
			'blockers': 'rose',
			'action items': 'emerald',
			'default': 'slate',
		};

		function flushSection() {
			if (!currentTitle) return;
			const lower = currentTitle.toLowerCase();
			const bodyText = currentLines.join('\n').trim();

			if (lower.includes('key metrics') || lower.includes('metrics')) {
				for (const line of currentLines) {
					const m = line.match(/^[-*]\s*\*\*(.+?)\*\*[:\s]*(.+)/);
					if (m) metrics.set(m[1].trim(), m[2].trim());
				}
			}

			const matchedKey = Object.keys(iconMap).find(k => lower.includes(k)) || 'default';
			sections.push({
				title: currentTitle,
				body: bodyText,
				icon: iconMap[matchedKey],
				accent: accentMap[matchedKey],
			});
			currentTitle = '';
			currentLines = [];
		}

		for (const line of lines) {
			const headingMatch = line.match(/^#{1,4}\s+(.+)/);
			if (headingMatch) {
				flushSection();
				currentTitle = headingMatch[1].trim();
				introComplete = true;
				continue;
			}
			if (!introComplete) {
				intro += (intro ? '\n' : '') + line;
			} else {
				currentLines.push(line);
			}
		}
		flushSection();

		return { intro: intro.trim(), sections, metrics };
	}

	let parsed = $derived(parseSections(content));
	let hasStructure = $derived(parsed.sections.length >= 2);

	let openSections = $state<Set<number>>(new Set([0]));

	function toggleSection(i: number) {
		const next = new Set(openSections);
		if (next.has(i)) next.delete(i);
		else next.add(i);
		openSections = next;
	}

	function expandAll() { openSections = new Set(parsed.sections.map((_, i) => i)); }
	function collapseAll() { openSections = new Set(); }

	function accentClasses(accent: string) {
		const map: Record<string, { bg: string; text: string; border: string; iconBg: string }> = {
			amber:   { bg: 'bg-amber-500/5',   text: 'text-amber-400',   border: 'border-amber-500/15', iconBg: 'bg-amber-500/15' },
			sky:     { bg: 'bg-sky-500/5',      text: 'text-sky-400',     border: 'border-sky-500/15',   iconBg: 'bg-sky-500/15' },
			rose:    { bg: 'bg-rose-500/5',      text: 'text-rose-400',    border: 'border-rose-500/15',  iconBg: 'bg-rose-500/15' },
			emerald: { bg: 'bg-emerald-500/5',  text: 'text-emerald-400', border: 'border-emerald-500/15', iconBg: 'bg-emerald-500/15' },
			slate:   { bg: 'bg-slate-500/5',    text: 'text-slate-400',   border: 'border-slate-500/15', iconBg: 'bg-slate-500/15' },
		};
		return map[accent] || map.slate;
	}
</script>

{#if hasStructure}
	<div
		class="card-enter glass rounded-2xl border border-red-500/20 overflow-hidden"
		in:fly={{ y: 10, duration: 280, easing: cubicOut }}
	>
		<!-- Header -->
		<div class="px-5 py-4 border-b border-white/5 bg-red-500/5">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<div class="w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center">
						<svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
						</svg>
					</div>
					<div>
						<h3 class="text-sm font-semibold text-white">Monday.com Report</h3>
						<p class="text-xs text-slate-400">{parsed.sections.length} sections</p>
					</div>
				</div>
				<div class="flex items-center gap-1.5">
					<button
						class="px-2 py-1 text-[10px] text-slate-500 hover:text-slate-300 glass rounded-md transition-colors"
						onclick={expandAll}
					>Expand all</button>
					<button
						class="px-2 py-1 text-[10px] text-slate-500 hover:text-slate-300 glass rounded-md transition-colors"
						onclick={collapseAll}
					>Collapse</button>
				</div>
			</div>
		</div>

		<!-- Intro summary -->
		{#if parsed.intro}
			<div class="px-5 py-3 text-sm text-slate-300 border-b border-white/5">
				<div class="prose-chat">
					{@html formatMessageWithMarkdown(parsed.intro)}
				</div>
			</div>
		{/if}

		<!-- Metrics quick strip -->
		{#if parsed.metrics.size > 0}
			<div class="px-5 py-3 flex flex-wrap gap-3 border-b border-white/5 bg-white/[0.02]">
				{#each [...parsed.metrics] as [label, value]}
					<div class="text-center">
						<div class="text-base font-bold text-amber-400">{value}</div>
						<div class="text-[10px] text-slate-500 mt-0.5">{label}</div>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Accordion sections -->
		<div class="divide-y divide-white/5">
			{#each parsed.sections as section, i}
				{@const colors = accentClasses(section.accent)}
				{@const isOpen = openSections.has(i)}
				<div>
					<button
						class="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-white/[0.02] transition-colors"
						onclick={() => toggleSection(i)}
						aria-expanded={isOpen}
					>
						<div class="w-7 h-7 rounded-lg {colors.iconBg} flex items-center justify-center flex-shrink-0">
							<svg class="w-3.5 h-3.5 {colors.text}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={section.icon} />
							</svg>
						</div>
						<span class="text-sm font-medium text-white flex-1">{section.title}</span>
						<svg
							class="w-4 h-4 text-slate-500 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}"
							fill="none" stroke="currentColor" viewBox="0 0 24 24"
						>
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
						</svg>
					</button>
					{#if isOpen}
						<div
							class="px-5 pb-4 pl-[3.75rem]"
							transition:slide={{ duration: 200, easing: cubicOut }}
						>
							<div class="prose-chat text-sm text-slate-300">
								{@html formatMessageWithMarkdown(section.body)}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}
