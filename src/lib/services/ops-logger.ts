/**
 * OpsLogger – fire-and-forget event logging to Supabase ops tables.
 * All methods are non-blocking so they never slow down user requests.
 */

import { getSupabaseClient } from './supabase';

// ─── Types ───────────────────────────────────────────────────

export interface OpsEvent {
	user_email?: string;
	user_name?: string;
	event_type: string;
	event_action?: string;
	route?: string;
	metadata?: Record<string, unknown>;
	duration_ms?: number;
}

export interface RagMetrics {
	query: string;
	user_email?: string;
	embed_ms?: number;
	dense_ms?: number;
	sparse_ms?: number;
	rerank_ms?: number;
	total_ms?: number;
	dense_count?: number;
	sparse_count?: number;
	fused_count?: number;
	reranked_count?: number;
	final_count?: number;
	avg_rerank_score?: number;
	max_rerank_score?: number;
	min_rerank_score?: number;
	context_token_estimate?: number;
	metadata?: Record<string, unknown>;
}

// ─── Logger ──────────────────────────────────────────────────

function safeLog(label: string, error: unknown) {
	console.error(`[OpsLogger] ${label}:`, error instanceof Error ? error.message : error);
}

/**
 * Log a user event (fire-and-forget).
 */
export function logEvent(event: OpsEvent): void {
	try {
		const supabase = getSupabaseClient();
		supabase
			.from('ops_events')
			.insert({
				user_email: event.user_email ?? null,
				user_name: event.user_name ?? null,
				event_type: event.event_type,
				event_action: event.event_action ?? null,
				route: event.route ?? null,
				metadata: event.metadata ?? {},
				duration_ms: event.duration_ms ?? null,
			})
			.then(({ error }) => {
				if (error) safeLog('logEvent insert failed', error.message);
			});
	} catch (e) {
		safeLog('logEvent', e);
	}
}

/**
 * Log RAG pipeline metrics (fire-and-forget).
 */
export function logRagMetrics(metrics: RagMetrics): void {
	try {
		const supabase = getSupabaseClient();
		supabase
			.from('ops_rag_metrics')
			.insert({
				query: metrics.query,
				user_email: metrics.user_email ?? null,
				embed_ms: metrics.embed_ms ?? null,
				dense_ms: metrics.dense_ms ?? null,
				sparse_ms: metrics.sparse_ms ?? null,
				rerank_ms: metrics.rerank_ms ?? null,
				total_ms: metrics.total_ms ?? null,
				dense_count: metrics.dense_count ?? null,
				sparse_count: metrics.sparse_count ?? null,
				fused_count: metrics.fused_count ?? null,
				reranked_count: metrics.reranked_count ?? null,
				final_count: metrics.final_count ?? null,
				avg_rerank_score: metrics.avg_rerank_score ?? null,
				max_rerank_score: metrics.max_rerank_score ?? null,
				min_rerank_score: metrics.min_rerank_score ?? null,
				context_token_estimate: metrics.context_token_estimate ?? null,
				metadata: metrics.metadata ?? {},
			})
			.then(({ error }) => {
				if (error) safeLog('logRagMetrics insert failed', error.message);
			});
	} catch (e) {
		safeLog('logRagMetrics', e);
	}
}

// ─── Query helpers (used by the /ops dashboard) ──────────────

export interface EventQueryOptions {
	limit?: number;
	offset?: number;
	user_email?: string;
	event_type?: string;
	route?: string;
	from?: string;   // ISO timestamp
	to?: string;     // ISO timestamp
}

export async function queryEvents(opts: EventQueryOptions = {}) {
	const supabase = getSupabaseClient();
	let q = supabase
		.from('ops_events')
		.select('*')
		.order('timestamp', { ascending: false });

	if (opts.user_email) q = q.eq('user_email', opts.user_email);
	if (opts.event_type) q = q.eq('event_type', opts.event_type);
	if (opts.route) q = q.eq('route', opts.route);
	if (opts.from) q = q.gte('timestamp', opts.from);
	if (opts.to) q = q.lte('timestamp', opts.to);

	q = q.range(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 50) - 1);

	const { data, error } = await q;
	if (error) throw new Error(`queryEvents: ${error.message}`);
	return data ?? [];
}

export async function queryEventStats(from?: string, to?: string) {
	const supabase = getSupabaseClient();

	let q = supabase.from('ops_events').select('user_email, user_name, event_type, route, timestamp, duration_ms');
	if (from) q = q.gte('timestamp', from);
	if (to) q = q.lte('timestamp', to);

	const { data, error } = await q;
	if (error) throw new Error(`queryEventStats: ${error.message}`);
	return data ?? [];
}

export async function queryRagMetrics(opts: { limit?: number; from?: string; to?: string } = {}) {
	const supabase = getSupabaseClient();
	let q = supabase
		.from('ops_rag_metrics')
		.select('*')
		.order('timestamp', { ascending: false });

	if (opts.from) q = q.gte('timestamp', opts.from);
	if (opts.to) q = q.lte('timestamp', opts.to);
	q = q.limit(opts.limit ?? 100);

	const { data, error } = await q;
	if (error) throw new Error(`queryRagMetrics: ${error.message}`);
	return data ?? [];
}

export async function queryAgentReports(limit = 10) {
	const supabase = getSupabaseClient();
	const { data, error } = await supabase
		.from('ops_agent_reports')
		.select('*')
		.order('created_at', { ascending: false })
		.limit(limit);

	if (error) throw new Error(`queryAgentReports: ${error.message}`);
	return data ?? [];
}

export async function insertAgentReport(report: {
	health_score: number;
	summary: string;
	report: Record<string, unknown>;
	triggered_by: string;
}) {
	const supabase = getSupabaseClient();
	const { data, error } = await supabase
		.from('ops_agent_reports')
		.insert(report)
		.select()
		.single();

	if (error) throw new Error(`insertAgentReport: ${error.message}`);
	return data;
}
