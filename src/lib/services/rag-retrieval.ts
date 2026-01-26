import pg from 'pg';
import { CohereClientV2 } from 'cohere-ai';
import { DEFAULT_RAG_CONFIG, type RagConfig } from './rag-config';

export type RagFilters = {
	tenant_id?: string;
	product?: string;
	version?: string;
	language?: string;
	fromDate?: string;
	toDate?: string;
};

export type RagChunk = {
	id: string;
	doc_id: string;
	section: string | null;
	order_index: number | null;
	content: string;
	external_url?: string | null;
	title?: string | null;
	updated_at?: string | null;
	score_dense?: number;
	score_sparse?: number;
	score_fused?: number;
	score_rerank?: number;
};

export type RagContext = {
	context: string;
	sources: Array<{
		id: string;
		title?: string | null;
		external_url?: string | null;
		section?: string | null;
		updated_at?: string | null;
	}>;
	chunks: RagChunk[];
};

const DEFAULT_CONFIG: RagConfig = DEFAULT_RAG_CONFIG;

let poolInstance: pg.Pool | null = null;

const getPool = (databaseUrl: string) => {
	if (!poolInstance) {
		poolInstance = new pg.Pool({
			connectionString: databaseUrl,
			ssl: { rejectUnauthorized: false },
			max: 10,
		});
	}
	return poolInstance;
};

const buildFilterClauses = (filters: RagFilters, params: any[]) => {
	const clauses: string[] = [];
	let paramIndex = params.length + 1;

	if (filters.tenant_id) {
		clauses.push(`c.tenant_id = $${paramIndex++}`);
		params.push(filters.tenant_id);
	}
	if (filters.product) {
		clauses.push(`c.product = $${paramIndex++}`);
		params.push(filters.product);
	}
	if (filters.version) {
		clauses.push(`c.version = $${paramIndex++}`);
		params.push(filters.version);
	}
	if (filters.language) {
		clauses.push(`c.language = $${paramIndex++}`);
		params.push(filters.language);
	}
	if (filters.fromDate) {
		clauses.push(`c.updated_at >= $${paramIndex++}`);
		params.push(filters.fromDate);
	}
	if (filters.toDate) {
		clauses.push(`c.updated_at <= $${paramIndex++}`);
		params.push(filters.toDate);
	}

	return clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '';
};

const mergeCandidates = (
	dense: RagChunk[],
	sparse: RagChunk[],
	weights: { dense: number; sparse: number }
): RagChunk[] => {
	const map = new Map<string, RagChunk>();

	for (const item of dense) {
		map.set(item.id, { ...item });
	}
	for (const item of sparse) {
		const existing = map.get(item.id);
		if (existing) {
			existing.score_sparse = item.score_sparse;
			map.set(item.id, existing);
		} else {
			map.set(item.id, { ...item });
		}
	}

	const merged = Array.from(map.values()).map((item) => {
		const denseScore = item.score_dense ?? 0;
		const sparseScore = item.score_sparse ?? 0;
		item.score_fused = denseScore * weights.dense + sparseScore * weights.sparse;
		return item;
	});

	return merged.sort((a, b) => (b.score_fused ?? 0) - (a.score_fused ?? 0));
};

export class RagRetrievalService {
	private cohere: CohereClientV2;
	private dbUrl: string;
	private config: RagConfig;

	constructor(databaseUrl: string, cohereApiKey: string, config?: Partial<RagConfig>) {
		this.cohere = new CohereClientV2({ token: cohereApiKey });
		this.dbUrl = databaseUrl;
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	private async embedQuery(query: string): Promise<number[]> {
		const response = await this.cohere.embed({
			texts: [query],
			model: 'embed-english-v3.0',
			inputType: 'search_query',
			embeddingTypes: ['float'],
		});
		const embeddings = response.embeddings;
		if (embeddings && 'float' in embeddings && embeddings.float?.length && embeddings.float.length > 0) {
			return embeddings.float[0];
		}
		throw new Error('No embeddings returned from Cohere');
	}

	private async denseSearch(queryEmbedding: number[], filters: RagFilters): Promise<RagChunk[]> {
		const pool = getPool(this.dbUrl);
		const params: any[] = [`[${queryEmbedding.join(',')}]`];
		const filterClause = buildFilterClauses(filters, params);
		const limitParam = params.length + 1;
		params.push(this.config.kDense);

		const sql = `
			SELECT
				c.id,
				c.doc_id,
				c.section,
				c.order_index,
				c.content,
				c.updated_at,
				d.title,
				d.external_url,
				1 - (c.embedding <=> $1) AS score_dense
			FROM chunks c
			JOIN documents d ON c.doc_id = d.id
			WHERE c.embedding IS NOT NULL
			${filterClause}
			ORDER BY c.embedding <=> $1
			LIMIT $${limitParam};
		`;

		const result = await pool.query(sql, params);
		return result.rows as RagChunk[];
	}

	private async sparseSearch(query: string, filters: RagFilters): Promise<RagChunk[]> {
		const pool = getPool(this.dbUrl);
		const params: any[] = [query];
		const filterClause = buildFilterClauses(filters, params);
		const limitParam = params.length + 1;
		params.push(this.config.kSparse);

		const sql = `
			SELECT
				c.id,
				c.doc_id,
				c.section,
				c.order_index,
				c.content,
				c.updated_at,
				d.title,
				d.external_url,
				ts_rank(c.tsv_content, websearch_to_tsquery('english', $1)) AS score_sparse
			FROM chunks c
			JOIN documents d ON c.doc_id = d.id
			WHERE c.tsv_content @@ websearch_to_tsquery('english', $1)
			${filterClause}
			ORDER BY score_sparse DESC
			LIMIT $${limitParam};
		`;

		const result = await pool.query(sql, params);
		return result.rows as RagChunk[];
	}

	private async rerank(query: string, candidates: RagChunk[]): Promise<RagChunk[]> {
		const documents = candidates.map((c) => c.content);
		const response = await this.cohere.rerank({
			model: 'rerank-v4.0-fast',
			query,
			documents,
			topN: Math.min(this.config.rerankTopK, candidates.length),
		});

		const reranked = response.results
			.map((res) => {
				const chunk = candidates[res.index];
				return {
					...chunk,
					score_rerank: res.relevanceScore,
				};
			})
			.filter((c) => (c.score_rerank ?? 0) >= this.config.rerankScoreThreshold);

		return reranked.sort((a, b) => (b.score_rerank ?? 0) - (a.score_rerank ?? 0));
	}

	private async expandNeighbors(anchors: RagChunk[]): Promise<RagChunk[]> {
		const pool = getPool(this.dbUrl);
		const expanded = new Map<string, RagChunk>();

		for (const anchor of anchors) {
			expanded.set(anchor.id, anchor);
			if (anchor.order_index === null) continue;

			const orderIndexes = [];
			for (let i = 1; i <= this.config.neighborWindow; i += 1) {
				orderIndexes.push(anchor.order_index - i, anchor.order_index + i);
			}

			const sql = `
				SELECT
					c.id,
					c.doc_id,
					c.section,
					c.order_index,
					c.content,
					c.updated_at,
					d.title,
					d.external_url
				FROM chunks c
				JOIN documents d ON c.doc_id = d.id
				WHERE c.doc_id = $1
					AND c.section = $2
					AND c.order_index = ANY($3::int[])
			`;

			const result = await pool.query(sql, [
				anchor.doc_id,
				anchor.section,
				orderIndexes,
			]);

			for (const row of result.rows as RagChunk[]) {
				expanded.set(row.id, row);
			}
		}

		return Array.from(expanded.values());
	}

	private buildContext(chunks: RagChunk[]): RagContext {
		const sorted = [...chunks].sort((a, b) => {
			if (a.doc_id !== b.doc_id) return a.doc_id.localeCompare(b.doc_id);
			if (a.section !== b.section) return String(a.section).localeCompare(String(b.section));
			return (a.order_index ?? 0) - (b.order_index ?? 0);
		});

		const sources = sorted.map((chunk, idx) => ({
			id: chunk.id,
			title: chunk.title || null,
			external_url: chunk.external_url || null,
			section: chunk.section || null,
			updated_at: chunk.updated_at || null,
			tag: `S${idx + 1}`,
		}));

		const contextLines: string[] = [];
		for (let i = 0; i < sorted.length && i < this.config.maxContextChunks; i += 1) {
			const chunk = sorted[i];
			const tag = `S${i + 1}`;
			contextLines.push(`[#${tag}] ${chunk.title || 'Untitled'} | ${chunk.section || 'General'}`);
			contextLines.push(chunk.content);
			contextLines.push('');
		}

		return {
			context: contextLines.join('\n'),
			sources: sources.slice(0, this.config.maxContextChunks),
			chunks: sorted.slice(0, this.config.maxContextChunks),
		};
	}

	async retrieve(query: string, filters: RagFilters = {}): Promise<RagContext> {
		const embedding = await this.embedQuery(query);
		const dense = await this.denseSearch(embedding, filters);
		const sparse = await this.sparseSearch(query, filters);
		const merged = mergeCandidates(dense, sparse, {
			dense: this.config.fusionWeightDense,
			sparse: this.config.fusionWeightSparse,
		});

		const reranked = await this.rerank(query, merged);
		const expanded = await this.expandNeighbors(reranked);

		return this.buildContext(expanded);
	}
}
