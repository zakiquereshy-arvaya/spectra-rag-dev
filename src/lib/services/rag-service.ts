// RAG Service - Orchestrates Cohere embeddings + Pinecone search + Cohere chat

import { CohereService } from './cohere';
import { queryPinecone } from './pinecone';
import { getChatHistory, setChatHistory, clearChatHistory } from './chat-history-store';
import type { ChatMessageV2 } from 'cohere-ai/api';

export class RAGService {
	private cohereService: CohereService;
	private sessionId: string;
	private chatHistory: ChatMessageV2[] = [];
	private topK: number;

	constructor(
		cohereService: CohereService,
		sessionId: string,
		topK: number = 5
	) {
		this.cohereService = cohereService;
		this.sessionId = sessionId;
		this.topK = topK;
		// Load existing chat history for this session
		this.chatHistory = getChatHistory(sessionId);
	}

	/**
	 * Query RAG system: embed query -> search Pinecone -> chat with documents
	 */
	async query(userMessage: string): Promise<string> {
		try {
			console.log('RAG query:', userMessage);

			// 1. Embed the user query
			const queryEmbeddings = await this.cohereService.embed(
				[userMessage],
				'embed-english-v3.0',
				'search_query'
			);
			const queryVector = queryEmbeddings[0];

			console.log('Query embedded, vector length:', queryVector.length);

			// 2. Search Pinecone with the query vector
			const documents = await queryPinecone(queryVector, this.topK);

			console.log('Pinecone search results:', documents.length, 'documents found');

			if (documents.length === 0) {
				// No documents found - still respond but let user know
				const response = await this.cohereService.chat(
					`User question: ${userMessage}\n\nNote: No relevant documents were found in the knowledge base. Please answer based on your general knowledge.`,
					undefined, // no tools
					this.chatHistory,
					undefined, // auto tool choice
					undefined // no documents
				);

				// Add to chat history
				this.chatHistory.push({
					role: 'user',
					content: userMessage,
				});
				this.chatHistory.push({
					role: 'assistant',
					content: response.text,
				});
				setChatHistory(this.sessionId, this.chatHistory);

				return response.text;
			}

			// 3. Format documents for Cohere Chat API
			const cohereDocs = documents.map(doc => ({
				content: doc.content,
				metadata: {
					score: doc.score,
					...(doc.metadata || {}),
				},
			}));

			// 4. Chat with documents using Cohere
			const response = await this.cohereService.chat(
				userMessage,
				undefined, // no tools
				this.chatHistory,
				undefined, // auto tool choice
				cohereDocs // documents for RAG
			);

			// 5. Add to chat history
			this.chatHistory.push({
				role: 'user',
				content: userMessage,
			});
			this.chatHistory.push({
				role: 'assistant',
				content: response.text,
			});
			setChatHistory(this.sessionId, this.chatHistory);

			return response.text;
		} catch (error: any) {
			console.error('RAG service error:', error);
			throw new Error(`RAG query error: ${error.message || 'Unknown error'}`);
		}
	}

	/**
	 * Clear chat history for this session
	 */
	clearHistory(): void {
		this.chatHistory = [];
		clearChatHistory(this.sessionId);
	}
}
