/**
 * DevOpsAgentService – autonomous intelligence agent for system health assessment.
 * Not a chatbot. Runs on-demand, gathers telemetry, feeds it to OpenAI, and
 * produces a structured health report.
 */

import OpenAI from 'openai';
import { queryEventStats, queryRagMetrics, insertAgentReport } from './ops-logger';
import { getRagConfig } from './rag-config';

// ─── Types ───────────────────────────────────────────────────

export interface AgentReport {
	health_score: number;
	summary: string;
	system_health: {
		status: string;
		details: string[];
	};
	usage_patterns: {
		total_events: number;
		unique_users: number;
		most_active_feature: string;
		peak_hour: string;
		details: string[];
	};
	anomalies: Array<{
		severity: 'low' | 'medium' | 'high' | 'critical';
		description: string;
		recommendation: string;
	}>;
	recommendations: Array<{
		priority: 'low' | 'medium' | 'high';
		title: string;
		description: string;
	}>;
	rag_performance: {
		avg_total_ms: number;
		avg_rerank_score: number;
		total_queries: number;
		details: string[];
	};
}

// ─── System Prompt ───────────────────────────────────────────

const DEVOPS_SYSTEM_PROMPT = `You are an autonomous DevOps intelligence agent for the Arvaya Spectra platform — a SvelteKit-based AI developer portal with calendar management (Billi/MoE), time entry, meeting transcript Q&A (Fireflies), and recruitment RAG search (Spectra RAG).

Your job is to analyze the following system telemetry and produce a structured health report. You are NOT a chatbot — you are an autonomous nervous system that assesses the health and performance of this platform.

Analyze the data for:
1. **System Health**: API response times, error rates, service availability
2. **Usage Patterns**: Who is using what, how often, peak hours, feature adoption
3. **Anomalies**: Unusual spikes, errors, performance degradation, inactive features
4. **RAG Performance**: Retrieval latency, rerank quality, context efficiency
5. **Recommendations**: Actionable improvements with priority levels

You MUST respond with valid JSON matching this exact schema:
{
  "health_score": <number 0-100>,
  "summary": "<1-2 sentence executive summary>",
  "system_health": {
    "status": "<healthy|degraded|critical>",
    "details": ["<detail 1>", "<detail 2>", ...]
  },
  "usage_patterns": {
    "total_events": <number>,
    "unique_users": <number>,
    "most_active_feature": "<feature name>",
    "peak_hour": "<HH:00 ET>",
    "details": ["<insight 1>", "<insight 2>", ...]
  },
  "anomalies": [
    {
      "severity": "<low|medium|high|critical>",
      "description": "<what was detected>",
      "recommendation": "<what to do about it>"
    }
  ],
  "recommendations": [
    {
      "priority": "<low|medium|high>",
      "title": "<short title>",
      "description": "<detailed recommendation>"
    }
  ],
  "rag_performance": {
    "avg_total_ms": <number>,
    "avg_rerank_score": <number>,
    "total_queries": <number>,
    "details": ["<insight 1>", "<insight 2>", ...]
  }
}

IMPORTANT: Output ONLY the JSON object, no markdown fences, no explanation text. Just raw JSON.`;

// ─── Agent ───────────────────────────────────────────────────

export class DevOpsAgentService {
	private client: OpenAI;

	constructor(apiKey: string) {
		this.client = new OpenAI({ apiKey });
	}

	/**
	 * Gather all telemetry data for analysis.
	 */
	private async gatherTelemetry(lookbackHours = 168) {
		const from = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

		const [events, ragMetrics] = await Promise.all([
			queryEventStats(from),
			queryRagMetrics({ limit: 200, from }),
		]);

		// Aggregate event stats
		const userMap = new Map<string, { name: string; count: number; types: Map<string, number>; routes: Map<string, number> }>();
		const hourMap = new Map<number, number>();
		const typeMap = new Map<string, number>();
		const routeMap = new Map<string, number>();
		let errorCount = 0;
		const durations: number[] = [];

		for (const evt of events) {
			// Per-user stats
			const email = evt.user_email || 'anonymous';
			if (!userMap.has(email)) {
				userMap.set(email, { name: evt.user_name || email, count: 0, types: new Map(), routes: new Map() });
			}
			const user = userMap.get(email)!;
			user.count++;
			user.types.set(evt.event_type, (user.types.get(evt.event_type) || 0) + 1);
			if (evt.route) user.routes.set(evt.route, (user.routes.get(evt.route) || 0) + 1);

			// Hour distribution
			const hour = new Date(evt.timestamp).getHours();
			hourMap.set(hour, (hourMap.get(hour) || 0) + 1);

			// Type distribution
			typeMap.set(evt.event_type, (typeMap.get(evt.event_type) || 0) + 1);

			// Route distribution
			if (evt.route) routeMap.set(evt.route, (routeMap.get(evt.route) || 0) + 1);

			// Duration tracking
			if (evt.duration_ms && evt.duration_ms > 0) {
				durations.push(evt.duration_ms);
			}
		}

		// RAG metrics aggregation
		const ragStats = {
			totalQueries: ragMetrics.length,
			avgTotalMs: 0,
			avgRerankScore: 0,
			avgDenseCount: 0,
			avgFinalCount: 0,
			avgContextTokens: 0,
			p95TotalMs: 0,
		};

		if (ragMetrics.length > 0) {
			const totals = ragMetrics.reduce(
				(acc, m) => ({
					totalMs: acc.totalMs + (m.total_ms || 0),
					rerankScore: acc.rerankScore + (m.avg_rerank_score || 0),
					denseCount: acc.denseCount + (m.dense_count || 0),
					finalCount: acc.finalCount + (m.final_count || 0),
					contextTokens: acc.contextTokens + (m.context_token_estimate || 0),
				}),
				{ totalMs: 0, rerankScore: 0, denseCount: 0, finalCount: 0, contextTokens: 0 },
			);
			const n = ragMetrics.length;
			ragStats.avgTotalMs = Math.round(totals.totalMs / n);
			ragStats.avgRerankScore = Math.round((totals.rerankScore / n) * 1000) / 1000;
			ragStats.avgDenseCount = Math.round(totals.denseCount / n);
			ragStats.avgFinalCount = Math.round(totals.finalCount / n);
			ragStats.avgContextTokens = Math.round(totals.contextTokens / n);

			// P95 latency
			const sortedMs = ragMetrics.map((m) => m.total_ms || 0).sort((a, b) => a - b);
			ragStats.p95TotalMs = sortedMs[Math.floor(sortedMs.length * 0.95)] || 0;
		}

		// Find peak hour
		let peakHour = 0;
		let peakCount = 0;
		for (const [hour, count] of hourMap) {
			if (count > peakCount) {
				peakHour = hour;
				peakCount = count;
			}
		}

		// Average response time
		const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

		// Current RAG config
		const ragConfig = getRagConfig();

		return {
			lookbackHours,
			totalEvents: events.length,
			uniqueUsers: userMap.size,
			userBreakdown: Array.from(userMap.entries()).map(([email, data]) => ({
				email,
				name: data.name,
				eventCount: data.count,
				topTypes: Array.from(data.types.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5),
				topRoutes: Array.from(data.routes.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5),
			})),
			eventTypeBreakdown: Array.from(typeMap.entries()).sort((a, b) => b[1] - a[1]),
			routeBreakdown: Array.from(routeMap.entries()).sort((a, b) => b[1] - a[1]),
			peakHour: `${peakHour.toString().padStart(2, '0')}:00 ET`,
			peakHourCount: peakCount,
			avgResponseTimeMs: avgDuration,
			errorCount,
			ragStats,
			ragConfig,
		};
	}

	/**
	 * Run a full assessment. Returns the parsed report and stores it in Supabase.
	 */
	async runAssessment(triggeredBy: string): Promise<AgentReport> {
		const telemetry = await this.gatherTelemetry(168); // 7 days

		const telemetryStr = JSON.stringify(telemetry, null, 2);

		const response = await this.client.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [
				{ role: 'system', content: DEVOPS_SYSTEM_PROMPT },
				{
					role: 'user',
					content: `Here is the system telemetry for the last ${telemetry.lookbackHours} hours:\n\n${telemetryStr}`,
				},
			],
			temperature: 0.3,
			max_tokens: 4000,
		});

		const rawContent = response.choices[0]?.message?.content ?? '{}';

		let report: AgentReport;
		try {
			report = JSON.parse(rawContent);
		} catch {
			// If the model wraps in markdown fences, strip them
			const cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
			report = JSON.parse(cleaned);
		}

		// Persist to Supabase
		await insertAgentReport({
			health_score: report.health_score ?? 0,
			summary: report.summary ?? '',
			report: report as unknown as Record<string, unknown>,
			triggered_by: triggeredBy,
		});

		return report;
	}
}
