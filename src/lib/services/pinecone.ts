// Pinecone RAG Service for Taleo Documentation
import { Pinecone } from '@pinecone-database/pinecone';
import { CohereClientV2 } from 'cohere-ai';

export interface QueryResult {
	id: string;
	score: number;
	text: string;
	metadata?: Record<string, unknown>;
}

export interface RAGContext {
	documents: QueryResult[];
	query: string;
}

export class PineconeRAGService {
	private pinecone: Pinecone;
	private cohere: CohereClientV2;
	private indexName: string;

	constructor(pineconeApiKey: string, cohereApiKey: string, indexName: string = 'taleo-doc') {
		this.pinecone = new Pinecone({
			apiKey: pineconeApiKey,
		});
		this.cohere = new CohereClientV2({
			token: cohereApiKey,
		});
		this.indexName = indexName;
	}

	/**
	 * Generate embeddings for a query using Cohere
	 */
	private async embedQuery(query: string): Promise<number[]> {
		const response = await this.cohere.embed({
			texts: [query],
			model: 'embed-english-v3.0',
			inputType: 'search_query',
			embeddingTypes: ['float'],
		});

		// Extract the float embeddings
		const embeddings = response.embeddings;
		if (embeddings && 'float' in embeddings && embeddings.float && embeddings.float.length > 0) {
			return embeddings.float[0];
		}

		throw new Error('Failed to generate embeddings');
	}

	/**
	 * Query Pinecone for relevant documents
	 */
	async query(query: string, topK: number = 8): Promise<QueryResult[]> {
		// Generate embedding for the query
		const queryEmbedding = await this.embedQuery(query);

		// Query Pinecone
		const index = this.pinecone.index(this.indexName);
		const results = await index.query({
			vector: queryEmbedding,
			topK,
			includeMetadata: true,
		});

		// Transform results
		return (results.matches || []).map((match) => {
			let text = '';
			if (match.metadata) {
				text =
					(match.metadata.text as string) ||
					(match.metadata.pageContent as string) ||
					(match.metadata.content as string) ||
					'';
			}

			return {
				id: match.id,
				score: match.score || 0,
				text,
				metadata: match.metadata as Record<string, unknown>,
			};
		});
	}

	async getContext(query: string, topK: number = 8): Promise<RAGContext> {
		const documents = await this.query(query, topK);
		return {
			documents,
			query,
		};
	}

	/**
	 * Format context for inclusion in LLM prompt
	 */
	static formatContextForPrompt(context: RAGContext): string {
		if (context.documents.length === 0) {
			return 'No relevant documents found in the knowledge base.';
		}

		const formattedDocs = context.documents
			.filter((doc) => doc.text && doc.text.trim().length > 0)
			.map((doc, index) => {
				const source = doc.metadata?.source || 'Unknown source';
				return `[Document ${index + 1}] (Source: ${source}, Relevance: ${(doc.score * 100).toFixed(1)}%)\n${doc.text}`;
			})
			.join('\n\n---\n\n');

		return formattedDocs || 'No relevant content found.';
	}
}
