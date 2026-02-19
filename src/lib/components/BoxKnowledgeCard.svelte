<script lang="ts">
	import { fly, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { formatMessageWithMarkdown } from '$lib/utils/sanitize';

	let { content }: { content: string } = $props();

	interface SourceRef {
		title: string;
		url?: string;
	}

	function dedupeSources(sources: SourceRef[]): SourceRef[] {
		const seen = new Set<string>();
		const deduped: SourceRef[] = [];
		for (const source of sources) {
			const key = (source.url || source.title).toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			deduped.push(source);
		}
		return deduped;
	}

	function parseSources(raw: string): { body: string; sources: SourceRef[] } {
		if (!raw) return { body: '', sources: [] };

		const lines = raw.split('\n');
		const sourceHeadingIdx = lines.findIndex((line) => /^#{1,4}\s+sources\b/i.test(line.trim()) || /^sources\s*:\s*$/i.test(line.trim()));

		const bodyLines = sourceHeadingIdx >= 0 ? lines.slice(0, sourceHeadingIdx) : lines;
		const sourceLines = sourceHeadingIdx >= 0 ? lines.slice(sourceHeadingIdx + 1) : [];
		const body = bodyLines.join('\n').trim();

		const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
		const urlRegex = /\bhttps?:\/\/[^\s)]+/g;
		const sources: SourceRef[] = [];

		for (const line of sourceLines) {
			for (const match of line.matchAll(markdownLinkRegex)) {
				const title = match[1]?.trim() || 'Source';
				const url = match[2]?.trim();
				if (url) sources.push({ title, url });
			}
		}

		for (const line of sourceLines) {
			const trimmed = line.trim();
			const plain = trimmed.match(/^[-*]\s+(.+)/);
			if (plain && !/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.test(trimmed)) {
				sources.push({ title: plain[1].trim() });
			}
		}

		for (const line of sourceLines) {
			for (const match of line.matchAll(urlRegex)) {
				const url = match[0]?.trim();
				if (url) sources.push({ title: 'Source', url });
			}
		}

		// Fallback: if no explicit "Sources" section exists, still surface inline links.
		if (sources.length === 0) {
			for (const match of raw.matchAll(markdownLinkRegex)) {
				const title = match[1]?.trim() || 'Source';
				const url = match[2]?.trim();
				if (url) sources.push({ title, url });
			}
		}

		return {
			body: body || raw.trim(),
			sources: dedupeSources(sources),
		};
	}

	let parsed = $derived(parseSources(content));
	let open = $state<Set<number>>(new Set([0]));

	function toggle(index: number) {
		const next = new Set(open);
		if (next.has(index)) next.delete(index);
		else next.add(index);
		open = next;
	}
</script>

<div class="card-enter glass rounded-2xl border border-[#0061FE]/25 overflow-hidden" in:fly={{ y: 10, duration: 280, easing: cubicOut }}>
	<div class="px-5 py-4 border-b border-white/5 bg-[#0061FE]/8">
		<div class="flex items-center gap-3">
			<div class="w-9 h-9 rounded-xl bg-[#0061FE]/20 flex items-center justify-center">
				<svg class="w-5 h-5 text-[#7fb0ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
				</svg>
			</div>
			<div>
				<h3 class="text-sm font-semibold text-white">Box Knowledge Response</h3>
				<p class="text-xs text-slate-400">{parsed.sources.length} source{parsed.sources.length !== 1 ? 's' : ''} cited</p>
			</div>
		</div>
	</div>

	<div class="divide-y divide-white/5">
		<div>
			<button
				class="w-full px-5 py-3 text-left flex items-center gap-3 hover:bg-white/2 transition-colors"
				onclick={() => toggle(0)}
				aria-expanded={open.has(0)}
			>
				<div class="w-7 h-7 rounded-lg bg-[#0061FE]/15 flex items-center justify-center shrink-0">
					<svg class="w-3.5 h-3.5 text-[#7fb0ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
				</div>
				<span class="text-sm font-medium text-white flex-1">Answer</span>
				<svg
					class="w-4 h-4 text-slate-500 transition-transform duration-200 {open.has(0) ? 'rotate-180' : ''}"
					fill="none" stroke="currentColor" viewBox="0 0 24 24"
				>
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
				</svg>
			</button>
			{#if open.has(0)}
				<div class="px-5 pb-4 pl-15" transition:slide={{ duration: 200, easing: cubicOut }}>
					<div class="prose-chat text-sm text-slate-300">
						{@html formatMessageWithMarkdown(parsed.body)}
					</div>
				</div>
			{/if}
		</div>

		{#if parsed.sources.length > 0}
			<div>
				<button
					class="w-full px-5 py-3 text-left flex items-center gap-3 hover:bg-white/2 transition-colors"
					onclick={() => toggle(1)}
					aria-expanded={open.has(1)}
				>
					<div class="w-7 h-7 rounded-lg bg-[#0061FE]/15 flex items-center justify-center shrink-0">
						<svg class="w-3.5 h-3.5 text-[#7fb0ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v11.494m-4.5-7.494h9" />
						</svg>
					</div>
					<span class="text-sm font-medium text-white flex-1">Sources</span>
					<svg
						class="w-4 h-4 text-slate-500 transition-transform duration-200 {open.has(1) ? 'rotate-180' : ''}"
						fill="none" stroke="currentColor" viewBox="0 0 24 24"
					>
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
					</svg>
				</button>
				{#if open.has(1)}
					<div class="px-5 pb-4 pl-15 space-y-1.5" transition:slide={{ duration: 200, easing: cubicOut }}>
						{#each parsed.sources as source, i}
							{#if source.url}
								<a
									href={source.url}
									target="_blank"
									rel="noopener noreferrer"
									class="block text-sm text-sky-300 hover:text-sky-200 underline underline-offset-2"
								>
									{i + 1}. {source.title}
								</a>
							{:else}
								<div class="text-sm text-slate-300">{i + 1}. {source.title}</div>
							{/if}
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
