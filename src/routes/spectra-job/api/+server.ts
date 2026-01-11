import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { RAGService } from '$lib/services/rag-service';
import { CohereService } from '$lib/services/cohere';
import { PUBLIC_COHERE_API_KEY } from '$env/static/public';

export const POST: RequestHandler = async (event) => {
	try {
		const body = await event.request.json();
		const { sessionId, message } = body;

		if (!message || typeof message !== 'string') {
			return json(
				{ error: 'Message is required and must be a string' },
				{ status: 400 }
			);
		}

		// Get Cohere API key
		const cohereApiKey = PUBLIC_COHERE_API_KEY;
		if (!cohereApiKey) {
			return json(
				{ error: 'Cohere API key not configured. Please set PUBLIC_COHERE_API_KEY environment variable.' },
				{ status: 500 }
			);
		}

		// Use provided sessionId or generate default
		const ragSessionId = sessionId || 'default';

		console.log('RAG API request:', {
			sessionId: ragSessionId,
			messageLength: message.length,
		});

		// Initialize services
		const cohereService = new CohereService(cohereApiKey, 'command-a-03-2025');
		const ragService = new RAGService(cohereService, ragSessionId, 5);

		// Query RAG system
		const response = await ragService.query(message);

		console.log('RAG API response:', {
			responseLength: response.length,
		});

		// Return response in same format as n8n for compatibility
		return json({
			output: response,
			response: response,
			message: response,
		});
	} catch (error: any) {
		console.error('RAG API error:', {
			message: error.message,
			stack: error.stack,
			name: error.name,
		});
		return json(
			{
				error: error.message || 'Internal error',
				output: `Error: ${error.message || 'An unexpected error occurred'}`,
			},
			{ status: 500 }
		);
	}
};
