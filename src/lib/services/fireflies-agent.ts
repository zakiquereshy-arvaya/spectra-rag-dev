// Fireflies Agent Service - RAG-powered meeting transcript Q&A
// Uses VectorDBService for semantic search and Cohere for response generation

import { CohereClientV2 } from 'cohere-ai';
import type { ChatMessageV2 } from 'cohere-ai/api';
import { VectorDBService, type SearchResult } from './vector-db';
import {
	getChatHistoryAsync,
	addMessagesToChatHistoryAsync,
	getPreparedChatHistoryAsync,
} from './chat-history-store';
import { RagRetrievalService } from './rag-retrieval';
import { getRagConfig } from './rag-config';
import { RAG_SYSTEM_PROMPT } from './rag-prompts';

// ============================================================================
// Types
// ============================================================================

export interface FirefliesAgentConfig {
	cohereApiKey: string;
	databaseUrl: string;
	sessionId: string;
}

export interface StreamChunk {
	type: 'text' | 'sources' | 'suggestions' | 'done' | 'error';
	content?: string;
	sources?: SearchResult[];
	suggestions?: string[];
	error?: string;
}

interface TranscriptDetails {
	id: string;
	title: string;
	date: Date;
	summary_overview?: string;
	summary_action_items?: string;
	summary_keywords?: string[];
	transcript_url?: string;
}

// ============================================================================
// Fireflies Agent Service
// ============================================================================

export class FirefliesAgent {
	private cohere: CohereClientV2;
	private vectorDB: VectorDBService;
	private rag: RagRetrievalService;
	private sessionId: string;
	private model: string = 'command-a-03-2025';

	constructor(config: FirefliesAgentConfig) {
		this.cohere = new CohereClientV2({ token: config.cohereApiKey });
		this.vectorDB = new VectorDBService(config.databaseUrl, config.cohereApiKey);
		this.rag = new RagRetrievalService(config.databaseUrl, config.cohereApiKey, getRagConfig());
		this.sessionId = config.sessionId;
	}

	/**
	 * Search transcripts and format results as context
	 */
	private async searchTranscripts(query: string, limit: number = 5): Promise<SearchResult[]> {
		try {
			const ragContext = await this.rag.retrieve(query);
			return ragContext.chunks.map((chunk) => ({
				id: `${chunk.doc_id}_chunk_${chunk.order_index ?? 0}`,
				title: chunk.title || 'Untitled',
				transcript_date: chunk.updated_at ? new Date(chunk.updated_at) : new Date(),
				similarity: chunk.score_rerank ?? chunk.score_fused ?? 0,
				excerpt: chunk.content,
				transcript_url: chunk.external_url || '',
				source: 'chunk',
				chunk_topic: chunk.section || undefined,
			}));
		} catch (error: any) {
			console.error('[FirefliesAgent] Search error:', error.message);
			return [];
		}
	}

	/**
	 * Get transcript details for action items
	 */
	private async getTranscriptDetails(transcriptId: string): Promise<TranscriptDetails | null> {
		try {
			const transcript = await this.vectorDB.getTranscript(transcriptId);
			if (!transcript) return null;

			return {
				id: transcript.id,
				title: transcript.title,
				date: new Date(transcript.transcript_date),
				summary_overview: transcript.summary_overview,
				summary_action_items: transcript.summary_action_items,
				summary_keywords: transcript.summary_keywords,
				transcript_url: transcript.transcript_url,
			};
		} catch (error: any) {
			console.error('[FirefliesAgent] Get transcript error:', error.message);
			return null;
		}
	}

	/**
	 * Extract action items from search results
	 */
	private async extractActionItems(results: SearchResult[]): Promise<string[]> {
		const actionItems: string[] = [];
		const seenIds = new Set<string>();

		for (const result of results.slice(0, 3)) {
			// Get top 3 transcripts
			const baseId = result.id.includes('_chunk_')
				? result.id.split('_chunk_')[0]
				: result.id;

			if (seenIds.has(baseId)) continue;
			seenIds.add(baseId);

			const details = await this.getTranscriptDetails(baseId);
			if (details?.summary_action_items) {
				// Parse action items (they might be newline or bullet separated)
				const items = details.summary_action_items
					.split(/[\n•\-]/)
					.map((item) => item.trim())
					.filter((item) => item.length > 10);

				for (const item of items.slice(0, 3)) {
					actionItems.push(`[${details.title}] ${item}`);
				}
			}
		}

		return actionItems.slice(0, 5); // Return max 5 action items
	}

	/**
	 * Format search results as context for the LLM
	 */
	private formatContext(results: SearchResult[]): string {
		if (results.length === 0) {
			return 'No relevant meeting transcripts found for this query.';
		}

		const contextParts: string[] = ['## Relevant Meeting Context\n'];

		for (let i = 0; i < results.length; i += 1) {
			const result = results[i];
			const tag = `S${i + 1}`;
			const dateStr = result.transcript_date.toLocaleDateString('en-US', {
				weekday: 'short',
				year: 'numeric',
				month: 'short',
				day: 'numeric',
			});

			contextParts.push(`### [${tag}] ${result.title}`);
			contextParts.push(`**Date:** ${dateStr}`);
			contextParts.push(`**Relevance:** ${(result.similarity * 100).toFixed(0)}%`);
			if (result.chunk_topic) {
				contextParts.push(`**Section:** ${result.chunk_topic}`);
			}
			contextParts.push(`\n> ${result.excerpt.substring(0, 500)}${result.excerpt.length > 500 ? '...' : ''}`);
			if (result.transcript_url) {
				contextParts.push(`[View Full Transcript](${result.transcript_url})`);
			}
			contextParts.push('\n---\n');
		}

		return contextParts.join('\n');
	}

	/**
	 * Build messages array for Cohere API
	 */
	private async buildMessages(
		userMessage: string,
		context: string,
		chatHistory: ChatMessageV2[]
	): Promise<ChatMessageV2[]> {
		const messages: ChatMessageV2[] = [
			{
				role: 'system',
				content: RAG_SYSTEM_PROMPT,
			},
		];

		// Add chat history (truncated to fit context)
		messages.push(...chatHistory);

		// Add context as a system message before user message
		messages.push({
			role: 'system',
			content: `The following context was retrieved from the meeting transcript database:\n\n${context}`,
		});

		// Add user message
		messages.push({
			role: 'user',
			content: userMessage,
		});

		return messages;
	}

	/**
	 * Handle a user request with streaming response
	 */
	async *handleRequestStream(request: { message: string }): AsyncGenerator<StreamChunk> {
		const { message } = request;

		try {
			console.log(`[FirefliesAgent] Processing: "${message.substring(0, 50)}..."`);

			// Step 1: Search for relevant transcripts
			const searchResults = await this.searchTranscripts(message, 5);
			console.log(`[FirefliesAgent] Found ${searchResults.length} relevant results`);

			// Yield sources early so UI can show them
			if (searchResults.length > 0) {
				yield {
					type: 'sources',
					sources: searchResults,
				};
			}

			// Step 2: Extract action items for suggestions
			const actionItems = await this.extractActionItems(searchResults);
			if (actionItems.length > 0) {
				yield {
					type: 'suggestions',
					suggestions: actionItems,
				};
			}

			// Step 3: Format context and get chat history
			const context = this.formatContext(searchResults);
			const chatHistory = await getPreparedChatHistoryAsync(this.sessionId, this.model);

			// Step 4: Build messages and stream response
			const messages = await this.buildMessages(message, context, chatHistory);

			const stream = await this.cohere.chatStream({
				model: this.model,
				messages,
			});

			let fullResponse = '';

			for await (const event of stream) {
				if (event.type === 'content-delta') {
					const delta = event.delta as any;
					if (delta?.message?.content?.text) {
						const text = delta.message.content.text;
						fullResponse += text;
						yield {
							type: 'text',
							content: text,
						};
					}
				} else if (event.type === 'message-end') {
					// Save to chat history
					await addMessagesToChatHistoryAsync(this.sessionId, [
						{ role: 'user', content: message },
						{ role: 'assistant', content: fullResponse },
					]);
				}
			}

			yield { type: 'done' };
		} catch (error: any) {
			console.error('[FirefliesAgent] Error:', error);
			yield {
				type: 'error',
				error: error.message || 'An unexpected error occurred',
			};
		}
	}

	/**
	 * Non-streaming version for simple queries
	 */
	async handleRequest(request: { message: string }): Promise<{
		response: string;
		sources: SearchResult[];
		suggestions: string[];
	}> {
		const { message } = request;
		let response = '';
		let sources: SearchResult[] = [];
		let suggestions: string[] = [];

		for await (const chunk of this.handleRequestStream(request)) {
			if (chunk.type === 'text' && chunk.content) {
				response += chunk.content;
			} else if (chunk.type === 'sources' && chunk.sources) {
				sources = chunk.sources;
			} else if (chunk.type === 'suggestions' && chunk.suggestions) {
				suggestions = chunk.suggestions;
			}
		}

		return { response, sources, suggestions };
	}

	/**
	 * Close database connections
	 */
	async close(): Promise<void> {
		await this.vectorDB.close();
	}
}

// ============================================================================
// Factory Function
// ============================================================================

export function createFirefliesAgent(config: FirefliesAgentConfig): FirefliesAgent {
	return new FirefliesAgent(config);
}
