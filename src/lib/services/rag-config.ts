export type RagConfig = {
	kDense: number;
	kSparse: number;
	fusionWeightDense: number;
	fusionWeightSparse: number;
	rerankTopK: number;
	rerankScoreThreshold: number;
	neighborWindow: number;
	maxContextChunks: number;
};

export const DEFAULT_RAG_CONFIG: RagConfig = {
	kDense: 60,
	kSparse: 40,
	fusionWeightDense: 0.7,
	fusionWeightSparse: 0.3,
	rerankTopK: 12,
	rerankScoreThreshold: 0.2,
	neighborWindow: 1,
	maxContextChunks: 20,
};

const toNumber = (value: string | undefined, fallback: number): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};

export const getRagConfig = (): RagConfig => {
	const env = typeof process !== 'undefined' ? process.env : {};
	return {
		kDense: toNumber(env.RAG_K_DENSE, DEFAULT_RAG_CONFIG.kDense),
		kSparse: toNumber(env.RAG_K_SPARSE, DEFAULT_RAG_CONFIG.kSparse),
		fusionWeightDense: toNumber(
			env.RAG_FUSION_DENSE_WEIGHT,
			DEFAULT_RAG_CONFIG.fusionWeightDense
		),
		fusionWeightSparse: toNumber(
			env.RAG_FUSION_SPARSE_WEIGHT,
			DEFAULT_RAG_CONFIG.fusionWeightSparse
		),
		rerankTopK: toNumber(env.RAG_RERANK_TOP_K, DEFAULT_RAG_CONFIG.rerankTopK),
		rerankScoreThreshold: toNumber(
			env.RAG_RERANK_SCORE_THRESHOLD,
			DEFAULT_RAG_CONFIG.rerankScoreThreshold
		),
		neighborWindow: toNumber(env.RAG_NEIGHBOR_WINDOW, DEFAULT_RAG_CONFIG.neighborWindow),
		maxContextChunks: toNumber(
			env.RAG_MAX_CONTEXT_CHUNKS,
			DEFAULT_RAG_CONFIG.maxContextChunks
		),
	};
};
