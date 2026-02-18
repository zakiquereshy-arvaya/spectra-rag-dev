<!-- src/routes/ops/+page.svelte – Arvaya Ops Dashboard -->
<script lang="ts">
	import type { PageData } from './$types';
	import { fly, fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	let { data }: { data: PageData } = $props();

	// ─── Tab State ────────────────────────────────
	type Tab = 'activity' | 'users' | 'agent' | 'context';
	let activeTab = $state<Tab>('agent');

	const tabs: { id: Tab; label: string; icon: string }[] = [
		{ id: 'agent', label: 'DevOps Agent', icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' },
		{ id: 'activity', label: 'Activity Feed', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
		{ id: 'users', label: 'User Analytics', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
		{ id: 'context', label: 'Context Engineering', icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4' },
	];

	// ─── Activity Feed State ─────────────────────
	let events = $state<any[]>([]);
	let eventsLoading = $state(false);
	let eventFilter = $state<string>('');
	let eventTypeFilter = $state<string>('');

	// ─── User Analytics State ────────────────────
	let userStats = $state<any[]>([]);
	let userStatsLoading = $state(false);

	// ─── Agent State ─────────────────────────────
	let agentReports = $state<any[]>([]);
	let latestReport = $state<any>(null);
	let agentLoading = $state(false);
	let agentRunning = $state(false);

	// ─── RAG Metrics State ───────────────────────
	let ragMetrics = $state<any[]>([]);
	let ragLoading = $state(false);

	// ─── Data Fetching ───────────────────────────
	async function fetchEvents() {
		eventsLoading = true;
		try {
			const params = new URLSearchParams({ limit: '100' });
			if (eventTypeFilter) params.set('event_type', eventTypeFilter);
			const res = await fetch(`/ops/api/events?${params}`);
			const json = await res.json();
			events = json.data ?? [];
		} catch (e) {
			console.error('Failed to fetch events:', e);
		} finally {
			eventsLoading = false;
		}
	}

	async function fetchUserStats() {
		userStatsLoading = true;
		try {
			const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
			const res = await fetch(`/ops/api/events?mode=stats&from=${from}`);
			const json = await res.json();
			userStats = json.data ?? [];
		} catch (e) {
			console.error('Failed to fetch user stats:', e);
		} finally {
			userStatsLoading = false;
		}
	}

	async function fetchAgentReports() {
		agentLoading = true;
		try {
			const res = await fetch('/ops/api/agent?limit=10');
			const json = await res.json();
			agentReports = json.data ?? [];
			if (agentReports.length > 0) {
				latestReport = agentReports[0];
			}
		} catch (e) {
			console.error('Failed to fetch agent reports:', e);
		} finally {
			agentLoading = false;
		}
	}

	async function runAssessment() {
		agentRunning = true;
		try {
			const res = await fetch('/ops/api/agent', { method: 'POST' });
			const json = await res.json();
			if (json.data) {
				latestReport = { report: json.data, created_at: new Date().toISOString(), triggered_by: data.session?.user?.email, health_score: json.data.health_score };
				agentReports = [latestReport, ...agentReports];
			}
		} catch (e) {
			console.error('Failed to run assessment:', e);
		} finally {
			agentRunning = false;
		}
	}

	async function fetchRagMetrics() {
		ragLoading = true;
		try {
			const res = await fetch('/ops/api/rag-metrics?limit=100');
			const json = await res.json();
			ragMetrics = json.data ?? [];
		} catch (e) {
			console.error('Failed to fetch RAG metrics:', e);
		} finally {
			ragLoading = false;
		}
	}

	// Load data when tab changes
	$effect(() => {
		if (activeTab === 'activity') fetchEvents();
		else if (activeTab === 'users') fetchUserStats();
		else if (activeTab === 'agent') fetchAgentReports();
		else if (activeTab === 'context') fetchRagMetrics();
	});

	// Refetch events when filter changes
	$effect(() => {
		eventTypeFilter;
		if (activeTab === 'activity') fetchEvents();
	});

	// ─── Computed User Analytics ─────────────────
	let userBreakdown = $derived.by(() => {
		const map = new Map<string, { name: string; email: string; count: number; types: Map<string, number>; lastActive: string }>();
		for (const evt of userStats) {
			const email = evt.user_email || 'anonymous';
			if (!map.has(email)) {
				map.set(email, { name: evt.user_name || email, email, count: 0, types: new Map(), lastActive: evt.timestamp });
			}
			const user = map.get(email)!;
			user.count++;
			user.types.set(evt.event_type, (user.types.get(evt.event_type) || 0) + 1);
			if (evt.timestamp > user.lastActive) user.lastActive = evt.timestamp;
		}
		return Array.from(map.values()).sort((a, b) => b.count - a.count);
	});

	let totalEventsThisWeek = $derived(userStats.length);
	let uniqueUsersThisWeek = $derived(new Set(userStats.map((e: any) => e.user_email)).size);

	// ─── Computed RAG Stats ──────────────────────
	let ragSummary = $derived.by(() => {
		if (ragMetrics.length === 0) return null;
		const n = ragMetrics.length;
		const avg = (key: string) => Math.round(ragMetrics.reduce((a: number, m: any) => a + (m[key] || 0), 0) / n);
		const avgFloat = (key: string) => Math.round((ragMetrics.reduce((a: number, m: any) => a + (m[key] || 0), 0) / n) * 1000) / 1000;
		return {
			totalQueries: n,
			avgTotalMs: avg('total_ms'),
			avgEmbedMs: avg('embed_ms'),
			avgDenseMs: avg('dense_ms'),
			avgSparseMs: avg('sparse_ms'),
			avgRerankMs: avg('rerank_ms'),
			avgRerankScore: avgFloat('avg_rerank_score'),
			avgFinalCount: avg('final_count'),
			avgContextTokens: avg('context_token_estimate'),
		};
	});

	let pipelineStages = $derived.by(() => {
		if (!ragSummary) return [];
		return [
			{ label: 'Embedding', ms: ragSummary.avgEmbedMs, color: 'bg-sky-500' },
			{ label: 'Dense Search', ms: ragSummary.avgDenseMs, color: 'bg-emerald-500' },
			{ label: 'Sparse Search', ms: ragSummary.avgSparseMs, color: 'bg-amber-500' },
			{ label: 'Reranking', ms: ragSummary.avgRerankMs, color: 'bg-violet-500' },
		];
	});

	let pipelineMaxMs = $derived(Math.max(...pipelineStages.map(s => s.ms), 1));

	// ─── Helpers ─────────────────────────────────
	function formatTime(iso: string) {
		return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	function formatTimeShort(iso: string) {
		return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
	}

	function relativeTime(iso: string) {
		const diff = Date.now() - new Date(iso).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function eventTypeColor(type: string) {
		switch (type) {
			case 'chat_message': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
			case 'page_view': return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
			case 'api_request': return 'text-sky-400 bg-sky-500/10 border-sky-500/20';
			case 'tool_call': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
			case 'rag_query': return 'text-violet-400 bg-violet-500/10 border-violet-500/20';
			case 'time_entry': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
			case 'booking': return 'text-sky-400 bg-sky-500/10 border-sky-500/20';
			default: return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
		}
	}

	function healthScoreColor(score: number) {
		if (score >= 80) return 'text-emerald-400';
		if (score >= 60) return 'text-amber-400';
		if (score >= 40) return 'text-orange-400';
		return 'text-red-400';
	}

	function healthScoreGradient(score: number) {
		if (score >= 80) return 'from-emerald-500 to-green-600';
		if (score >= 60) return 'from-amber-500 to-orange-500';
		if (score >= 40) return 'from-orange-500 to-red-500';
		return 'from-red-500 to-red-700';
	}

	function severityColor(severity: string) {
		switch (severity) {
			case 'critical': return 'text-red-400 bg-red-500/10 border-red-500/30';
			case 'high': return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
			case 'medium': return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
			default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
		}
	}

	function priorityColor(priority: string) {
		switch (priority) {
			case 'high': return 'text-red-400';
			case 'medium': return 'text-amber-400';
			default: return 'text-slate-400';
		}
	}

	let filteredEvents = $derived.by(() => {
		if (!eventFilter) return events;
		const lower = eventFilter.toLowerCase();
		return events.filter((e: any) =>
			(e.user_email || '').toLowerCase().includes(lower) ||
			(e.user_name || '').toLowerCase().includes(lower) ||
			(e.route || '').toLowerCase().includes(lower) ||
			(e.event_action || '').toLowerCase().includes(lower)
		);
	});
</script>

<div class="relative flex h-screen flex-col overflow-hidden mesh-gradient-subtle">
	<div class="pointer-events-none absolute inset-0 dot-pattern opacity-30"></div>
	<div class="ambient-orb ambient-orb-amber"></div>
	<div class="ambient-orb ambient-orb-sky"></div>
	<div class="ambient-orb ambient-orb-violet"></div>

	<!-- Header -->
	<header class="glass sticky top-0 z-20 border-b border-white/5 px-6 py-4">
		<div class="max-w-7xl mx-auto flex justify-between items-center">
			<div class="flex items-center gap-4">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
						<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"></path>
						</svg>
					</div>
					<div>
						<h1 class="text-xl font-bold text-white">Ops Center</h1>
						<div class="mt-0.5 flex items-center gap-2">
							<span class="live-dot"></span>
							<p class="text-xs text-slate-400">Arvaya Platform Intelligence</p>
						</div>
					</div>
				</div>
			</div>
			<div class="text-xs text-slate-500">
				{data.session?.user?.name ?? 'Operator'}
			</div>
		</div>
	</header>

	<!-- Tab Navigation -->
	<div class="glass border-b border-white/5 px-6">
		<div class="max-w-7xl mx-auto flex gap-1 py-2">
			{#each tabs as tab}
				<button
					onclick={() => (activeTab = tab.id)}
					class="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 btn-press
						{activeTab === tab.id
							? 'bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 text-violet-300 border border-violet-500/20'
							: 'text-slate-400 hover:text-white hover:bg-white/[0.04]'}"
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={tab.icon}></path>
					</svg>
					{tab.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Content -->
	<div class="relative z-10 flex-1 overflow-y-auto px-6 py-6">
		<div class="max-w-7xl mx-auto">

			<!-- ═══════════ AGENT TAB ═══════════ -->
			{#if activeTab === 'agent'}
				<div in:fade={{ duration: 200 }}>
					<!-- Agent Header -->
					<div class="flex items-center justify-between mb-8">
						<div class="flex items-center gap-4">
							<div class="relative">
								<div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-xl shadow-violet-500/30 {agentRunning ? 'avatar-thinking' : ''}">
									<svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
									</svg>
								</div>
								<span class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full {agentRunning ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'} border-2 border-[#0a0a0f]"></span>
							</div>
							<div>
								<h2 class="text-2xl font-bold text-white">DevOps Agent</h2>
								<p class="text-sm text-slate-400">
									{#if agentRunning}
										<span class="text-amber-400">Analyzing system telemetry...</span>
									{:else if latestReport}
										Last assessment: {relativeTime(latestReport.created_at)}
									{:else}
										No assessments yet
									{/if}
								</p>
							</div>
						</div>
						<button
							onclick={runAssessment}
							disabled={agentRunning}
							class="px-6 py-3 bg-gradient-to-r from-violet-500 to-fuchsia-600 text-white rounded-xl font-medium
								hover:from-violet-400 hover:to-fuchsia-500
								disabled:opacity-50 disabled:cursor-not-allowed
								transition-all shadow-lg shadow-violet-500/20 btn-press btn-glow flex items-center gap-2"
						>
							{#if agentRunning}
								<svg class="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
								Running Assessment
							{:else}
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
								</svg>
								Run Assessment
							{/if}
						</button>
					</div>

					{#if agentLoading && !latestReport}
						<div class="flex items-center justify-center py-20">
							<div class="flex items-center gap-3 text-slate-400">
								<svg class="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
								Loading agent reports...
							</div>
						</div>
					{:else if latestReport}
						{@const report = latestReport.report || latestReport}
						<!-- Health Score Card -->
						<div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
							<div class="glass rounded-2xl p-6 flex flex-col items-center justify-center card-hover">
								<div class="text-5xl font-bold {healthScoreColor(report.health_score ?? 0)} mb-2">
									{report.health_score ?? '—'}
								</div>
								<p class="text-xs text-slate-400 uppercase tracking-wider">Health Score</p>
								<div class="mt-3 w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
									<div
										class="h-full rounded-full bg-gradient-to-r {healthScoreGradient(report.health_score ?? 0)} transition-all duration-700"
										style="width: {report.health_score ?? 0}%"
									></div>
								</div>
							</div>
							<div class="glass rounded-2xl p-6 card-hover">
								<div class="flex items-center gap-2 mb-3">
									<div class="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
										<svg class="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
										</svg>
									</div>
									<p class="text-xs text-slate-400 uppercase tracking-wider">System Status</p>
								</div>
								<p class="text-lg font-semibold text-white capitalize">{report.system_health?.status ?? 'Unknown'}</p>
							</div>
							<div class="glass rounded-2xl p-6 card-hover">
								<div class="flex items-center gap-2 mb-3">
									<div class="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
										<svg class="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path>
										</svg>
									</div>
									<p class="text-xs text-slate-400 uppercase tracking-wider">Active Users</p>
								</div>
								<p class="text-lg font-semibold text-white">{report.usage_patterns?.unique_users ?? 0}</p>
							</div>
							<div class="glass rounded-2xl p-6 card-hover">
								<div class="flex items-center gap-2 mb-3">
									<div class="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
										<svg class="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
										</svg>
									</div>
									<p class="text-xs text-slate-400 uppercase tracking-wider">Peak Hour</p>
								</div>
								<p class="text-lg font-semibold text-white">{report.usage_patterns?.peak_hour ?? '—'}</p>
							</div>
						</div>

						<!-- Summary -->
						<div class="glass rounded-2xl p-6 mb-6">
							<h3 class="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">Agent Summary</h3>
							<p class="text-slate-200 leading-relaxed">{report.summary ?? 'No summary available.'}</p>
						</div>

						<!-- System Health Details -->
						{#if report.system_health?.details?.length}
							<div class="glass rounded-2xl p-6 mb-6 card-hover">
								<h3 class="text-sm font-semibold text-sky-400 uppercase tracking-wider mb-4 flex items-center gap-2">
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
									</svg>
									System Health
								</h3>
								<ul class="space-y-2">
									{#each report.system_health.details as detail}
										<li class="flex items-start gap-2 text-sm text-slate-300">
											<span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-sky-400 flex-shrink-0"></span>
											{detail}
										</li>
									{/each}
								</ul>
							</div>
						{/if}

						<!-- Anomalies -->
						{#if report.anomalies?.length}
							<div class="glass rounded-2xl p-6 mb-6 card-hover">
								<h3 class="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4 flex items-center gap-2">
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
									</svg>
									Anomalies Detected
								</h3>
								<div class="space-y-3">
									{#each report.anomalies as anomaly}
										<div class="rounded-xl border px-4 py-3 {severityColor(anomaly.severity)}">
											<div class="flex items-center gap-2 mb-1">
												<span class="text-xs font-semibold uppercase">{anomaly.severity}</span>
											</div>
											<p class="text-sm text-slate-200 mb-1">{anomaly.description}</p>
											<p class="text-xs text-slate-400">{anomaly.recommendation}</p>
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Recommendations -->
						{#if report.recommendations?.length}
							<div class="glass rounded-2xl p-6 mb-6 card-hover">
								<h3 class="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-4 flex items-center gap-2">
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
									</svg>
									Recommendations
								</h3>
								<div class="space-y-3">
									{#each report.recommendations as rec}
										<div class="flex items-start gap-3 text-sm">
											<span class="mt-0.5 px-2 py-0.5 rounded text-xs font-semibold uppercase {priorityColor(rec.priority)} bg-white/[0.04]">{rec.priority}</span>
											<div>
												<p class="font-medium text-slate-200">{rec.title}</p>
												<p class="text-slate-400 mt-0.5">{rec.description}</p>
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- RAG Performance from Agent -->
						{#if report.rag_performance}
							<div class="glass rounded-2xl p-6 mb-6 card-hover">
								<h3 class="text-sm font-semibold text-violet-400 uppercase tracking-wider mb-4 flex items-center gap-2">
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"></path>
									</svg>
									RAG Performance (Agent View)
								</h3>
								<div class="grid grid-cols-3 gap-4 mb-4">
									<div>
										<p class="text-xs text-slate-500">Avg Latency</p>
										<p class="text-lg font-semibold text-white">{report.rag_performance.avg_total_ms}ms</p>
									</div>
									<div>
										<p class="text-xs text-slate-500">Avg Rerank Score</p>
										<p class="text-lg font-semibold text-white">{report.rag_performance.avg_rerank_score}</p>
									</div>
									<div>
										<p class="text-xs text-slate-500">Total Queries</p>
										<p class="text-lg font-semibold text-white">{report.rag_performance.total_queries}</p>
									</div>
								</div>
								{#if report.rag_performance.details?.length}
									<ul class="space-y-1">
										{#each report.rag_performance.details as detail}
											<li class="flex items-start gap-2 text-sm text-slate-300">
												<span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-violet-400 flex-shrink-0"></span>
												{detail}
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/if}

						<!-- Past Reports -->
						{#if agentReports.length > 1}
							<div class="glass rounded-2xl p-6">
								<h3 class="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Past Assessments</h3>
								<div class="space-y-2">
									{#each agentReports.slice(1) as report}
										<button
											onclick={() => (latestReport = report)}
											class="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-white/[0.04] transition-colors text-left"
										>
											<div class="flex items-center gap-3">
												<span class="text-2xl font-bold {healthScoreColor(report.health_score ?? report.report?.health_score ?? 0)}">{report.health_score ?? report.report?.health_score ?? '—'}</span>
												<div>
													<p class="text-sm text-slate-200">{report.summary || report.report?.summary || 'Assessment report'}</p>
													<p class="text-xs text-slate-500">{formatTime(report.created_at)} &middot; by {report.triggered_by ?? 'unknown'}</p>
												</div>
											</div>
											<svg class="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
											</svg>
										</button>
									{/each}
								</div>
							</div>
						{/if}
					{:else}
						<div class="flex flex-col items-center justify-center py-20 text-center">
							<div class="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-600/20 flex items-center justify-center mb-6">
								<svg class="w-10 h-10 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
								</svg>
							</div>
							<h3 class="text-xl font-semibold text-white mb-2">No Assessments Yet</h3>
							<p class="text-slate-400 max-w-md mb-6">The DevOps agent has not run any assessments. Click "Run Assessment" to have the agent analyze your platform's health and usage patterns.</p>
						</div>
					{/if}
				</div>

			<!-- ═══════════ ACTIVITY TAB ═══════════ -->
			{:else if activeTab === 'activity'}
				<div in:fade={{ duration: 200 }}>
					<div class="flex items-center justify-between mb-6">
						<h2 class="text-xl font-bold text-white">Activity Feed</h2>
						<div class="flex items-center gap-3">
							<input
								type="text"
								placeholder="Filter events..."
								bind:value={eventFilter}
								class="px-3 py-2 text-sm glass-input rounded-lg text-white placeholder-slate-500 focus:outline-none w-56"
							/>
							<select
								bind:value={eventTypeFilter}
								class="px-3 py-2 text-sm rounded-lg bg-white/[0.04] border border-white/[0.08] text-slate-300 focus:outline-none focus:border-violet-500/40"
							>
								<option value="">All types</option>
								<option value="page_view">Page Views</option>
								<option value="chat_message">Chat Messages</option>
								<option value="api_request">API Requests</option>
								<option value="rag_query">RAG Queries</option>
								<option value="tool_call">Tool Calls</option>
							</select>
						</div>
					</div>

					{#if eventsLoading}
						<div class="flex items-center justify-center py-20">
							<div class="flex items-center gap-3 text-slate-400">
								<svg class="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
								Loading events...
							</div>
						</div>
					{:else if filteredEvents.length === 0}
						<div class="flex flex-col items-center justify-center py-20 text-center">
							<p class="text-slate-400">No events found. Events will appear once users interact with the platform.</p>
						</div>
					{:else}
						<div class="space-y-2">
							{#each filteredEvents as event, i (event.id)}
								<div
									class="glass rounded-xl px-4 py-3 flex items-center gap-4 card-hover"
									in:fly={{ y: 8, duration: 200, delay: Math.min(i * 20, 300) }}
								>
									<span class="px-2 py-0.5 rounded text-xs font-medium border {eventTypeColor(event.event_type)}">
										{event.event_type}
									</span>
									<div class="flex-1 min-w-0">
										<p class="text-sm text-slate-200 truncate">
											<span class="font-medium text-white">{event.user_name || event.user_email || 'Anonymous'}</span>
											{#if event.event_action}
												<span class="text-slate-400"> &middot; {event.event_action}</span>
											{/if}
										</p>
										<p class="text-xs text-slate-500 truncate">
											{event.route || 'unknown route'}
											{#if event.duration_ms}
												<span> &middot; {event.duration_ms}ms</span>
											{/if}
										</p>
									</div>
									<span class="text-xs text-slate-500 flex-shrink-0">{relativeTime(event.timestamp)}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>

			<!-- ═══════════ USERS TAB ═══════════ -->
			{:else if activeTab === 'users'}
				<div in:fade={{ duration: 200 }}>
					<!-- Summary Cards -->
					<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
						<div class="glass rounded-2xl p-6 card-hover">
							<p class="text-xs text-slate-400 uppercase tracking-wider mb-2">Total Events (7d)</p>
							<p class="text-3xl font-bold text-white">{totalEventsThisWeek}</p>
						</div>
						<div class="glass rounded-2xl p-6 card-hover">
							<p class="text-xs text-slate-400 uppercase tracking-wider mb-2">Unique Users (7d)</p>
							<p class="text-3xl font-bold text-white">{uniqueUsersThisWeek}</p>
						</div>
						<div class="glass rounded-2xl p-6 card-hover">
							<p class="text-xs text-slate-400 uppercase tracking-wider mb-2">Avg Events/User</p>
							<p class="text-3xl font-bold text-white">{uniqueUsersThisWeek > 0 ? Math.round(totalEventsThisWeek / uniqueUsersThisWeek) : 0}</p>
						</div>
					</div>

					<h2 class="text-xl font-bold text-white mb-4">User Breakdown</h2>

					{#if userStatsLoading}
						<div class="flex items-center justify-center py-20">
							<div class="flex items-center gap-3 text-slate-400">
								<svg class="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
								Loading user analytics...
							</div>
						</div>
					{:else if userBreakdown.length === 0}
						<div class="flex flex-col items-center justify-center py-20 text-center">
							<p class="text-slate-400">No user activity data yet.</p>
						</div>
					{:else}
						<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
							{#each userBreakdown as user, i}
								<div
									class="glass rounded-2xl p-6 card-hover"
									in:fly={{ y: 8, duration: 200, delay: Math.min(i * 50, 200) }}
								>
									<div class="flex items-center gap-3 mb-4">
										<div class="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-semibold">
											{(user.name || '?').charAt(0).toUpperCase()}
										</div>
										<div class="flex-1 min-w-0">
											<p class="font-medium text-white truncate">{user.name}</p>
											<p class="text-xs text-slate-400 truncate">{user.email}</p>
										</div>
										<div class="text-right">
											<p class="text-xl font-bold text-white">{user.count}</p>
											<p class="text-xs text-slate-500">events</p>
										</div>
									</div>
									<div class="flex flex-wrap gap-2">
										{#each Array.from(user.types.entries()).sort((a, b) => b[1] - a[1]) as [type, count]}
											<span class="px-2 py-1 rounded text-xs border {eventTypeColor(type)}">
												{type}: {count}
											</span>
										{/each}
									</div>
									<p class="text-xs text-slate-500 mt-3">Last active: {relativeTime(user.lastActive)}</p>
								</div>
							{/each}
						</div>
					{/if}
				</div>

			<!-- ═══════════ CONTEXT ENGINEERING TAB ═══════════ -->
			{:else if activeTab === 'context'}
				<div in:fade={{ duration: 200 }}>
					<h2 class="text-xl font-bold text-white mb-6">Context Engineering Metrics</h2>

					{#if ragLoading}
						<div class="flex items-center justify-center py-20">
							<div class="flex items-center gap-3 text-slate-400">
								<svg class="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
								Loading RAG metrics...
							</div>
						</div>
					{:else if !ragSummary}
						<div class="flex flex-col items-center justify-center py-20 text-center">
							<div class="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-600/20 flex items-center justify-center mb-6">
								<svg class="w-10 h-10 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"></path>
								</svg>
							</div>
							<h3 class="text-xl font-semibold text-white mb-2">No RAG Metrics Yet</h3>
							<p class="text-slate-400 max-w-md">RAG pipeline metrics will appear once users make queries through the RAG endpoints. Each query records timing and quality data automatically.</p>
						</div>
					{:else}
						<!-- Summary Stats -->
						<div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
							<div class="glass rounded-2xl p-5 card-hover">
								<p class="text-xs text-slate-400 uppercase tracking-wider mb-1">Total Queries</p>
								<p class="text-2xl font-bold text-white">{ragSummary.totalQueries}</p>
							</div>
							<div class="glass rounded-2xl p-5 card-hover">
								<p class="text-xs text-slate-400 uppercase tracking-wider mb-1">Avg Latency</p>
								<p class="text-2xl font-bold text-white">{ragSummary.avgTotalMs}<span class="text-sm text-slate-400">ms</span></p>
							</div>
							<div class="glass rounded-2xl p-5 card-hover">
								<p class="text-xs text-slate-400 uppercase tracking-wider mb-1">Avg Rerank Score</p>
								<p class="text-2xl font-bold text-violet-400">{ragSummary.avgRerankScore}</p>
							</div>
							<div class="glass rounded-2xl p-5 card-hover">
								<p class="text-xs text-slate-400 uppercase tracking-wider mb-1">Avg Chunks Used</p>
								<p class="text-2xl font-bold text-white">{ragSummary.avgFinalCount}</p>
							</div>
							<div class="glass rounded-2xl p-5 card-hover">
								<p class="text-xs text-slate-400 uppercase tracking-wider mb-1">Avg Context Tokens</p>
								<p class="text-2xl font-bold text-white">{ragSummary.avgContextTokens}</p>
							</div>
						</div>

						<!-- Latency Breakdown -->
						<div class="glass rounded-2xl p-6 mb-6 card-hover">
							<h3 class="text-sm font-semibold text-violet-400 uppercase tracking-wider mb-4">Pipeline Latency Breakdown (Avg)</h3>
							<div class="space-y-3">
								{#each pipelineStages as stage}
									<div class="flex items-center gap-3">
										<span class="text-xs text-slate-400 w-28 shrink-0">{stage.label}</span>
										<div class="flex-1 h-6 rounded-lg bg-white/4 overflow-hidden relative">
											<div
												class="h-full rounded-lg {stage.color} opacity-70 transition-all duration-500"
												style="width: {Math.max((stage.ms / pipelineMaxMs) * 100, 2)}%"
											></div>
										</div>
										<span class="text-xs text-slate-300 w-16 text-right font-mono">{stage.ms}ms</span>
									</div>
								{/each}
								<div class="flex items-center gap-3 pt-2 border-t border-white/6">
									<span class="text-xs text-white font-semibold w-28 shrink-0">Total</span>
									<div class="flex-1"></div>
									<span class="text-xs text-white w-16 text-right font-mono font-semibold">{ragSummary.avgTotalMs}ms</span>
								</div>
							</div>
						</div>

						<!-- Recent Queries -->
						<div class="glass rounded-2xl p-6 card-hover">
							<h3 class="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Recent Queries</h3>
							<div class="overflow-x-auto">
								<table class="w-full text-sm">
									<thead>
										<tr class="text-xs text-slate-500 uppercase tracking-wider">
											<th class="text-left pb-3 pr-4">Query</th>
											<th class="text-right pb-3 px-2">Total</th>
											<th class="text-right pb-3 px-2">Embed</th>
											<th class="text-right pb-3 px-2">Dense</th>
											<th class="text-right pb-3 px-2">Sparse</th>
											<th class="text-right pb-3 px-2">Rerank</th>
											<th class="text-right pb-3 px-2">Score</th>
											<th class="text-right pb-3 pl-2">Chunks</th>
										</tr>
									</thead>
									<tbody>
										{#each ragMetrics.slice(0, 20) as m}
											<tr class="border-t border-white/[0.04] hover:bg-white/[0.02]">
												<td class="py-2.5 pr-4 max-w-[200px] truncate text-slate-300" title={m.query}>{m.query}</td>
												<td class="py-2.5 px-2 text-right font-mono text-white">{m.total_ms}ms</td>
												<td class="py-2.5 px-2 text-right font-mono text-sky-400">{m.embed_ms ?? '—'}</td>
												<td class="py-2.5 px-2 text-right font-mono text-emerald-400">{m.dense_ms ?? '—'}</td>
												<td class="py-2.5 px-2 text-right font-mono text-amber-400">{m.sparse_ms ?? '—'}</td>
												<td class="py-2.5 px-2 text-right font-mono text-violet-400">{m.rerank_ms ?? '—'}</td>
												<td class="py-2.5 px-2 text-right font-mono text-violet-300">{m.avg_rerank_score ?? '—'}</td>
												<td class="py-2.5 pl-2 text-right font-mono text-slate-300">{m.final_count ?? '—'}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
