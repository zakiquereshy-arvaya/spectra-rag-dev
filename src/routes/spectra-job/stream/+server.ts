import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { PineconeRAGService } from '$lib/services/pinecone';
import { CohereClientV2 } from 'cohere-ai';
import { getChatHistory, setChatHistory } from '$lib/services/chat-history-store';
import { logEvent } from '$lib/services/ops-logger';
import type { ChatMessageV2 } from 'cohere-ai/api';

const SYSTEM_PROMPT = `You are an expert assistant for Taleo API and Spectra's recruiting requirements. You help users understand the Taleo API documentation and Spectra's specific needs from meeting transcripts.

**Your Knowledge Base Contains:**
- Official Taleo API documentation (endpoints, authentication, parameters)
- Meeting transcripts with Spectra discussing their recruiting automation needs

**Guidelines:**
1. Answer questions clearly and concisely using the provided context
2. When discussing Taleo API endpoints, include: endpoint URL, HTTP method, required parameters
3. When discussing Spectra's requirements, reference specific details from meeting transcripts
4. Use bullet points for clarity
5. Be concrete and actionable
6. If the context doesn't contain relevant information, say "I don't have specific information about this in my knowledge base."

**Important:**
- Do NOT mention tool calls, function calls, or search operations in your response
- Do NOT include source citations or document references in your response
- Just provide the answer naturally as if you already know the information
- Never output raw JSON or technical artifacts`;

export const POST: RequestHandler = async (event) => {
	const session = await event.locals.auth();

	if (!session) {
		return new Response('Unauthorized', { status: 401 });
	}

	if (!env.COHERE_API_KEY) {
		return new Response('Cohere API key not configured', { status: 500 });
	}

	if (!env.PINECONE_API_KEY) {
		return new Response('Pinecone API key not configured', { status: 500 });
	}

	try {
		const body = await event.request.json();
		const { message, sessionId = 'default' } = body;

		if (!message || typeof message !== 'string') {
			return new Response(JSON.stringify({ error: 'Message is required' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		logEvent({
			user_email: session.user?.email ?? undefined,
			user_name: session.user?.name ?? undefined,
			event_type: 'chat_message',
			event_action: 'send_message',
			route: '/spectra-job/stream',
			metadata: { sessionId, messageLength: message.length },
		});

		// Initialize services
		const ragService = new PineconeRAGService(env.PINECONE_API_KEY, env.COHERE_API_KEY, 'taleo-doc');
		const cohere = new CohereClientV2({ token: env.COHERE_API_KEY });

		// Get RAG context from Pinecone
		console.log('Querying Pinecone for:', message);
		const context = await ragService.getContext(message, 8);
		const formattedContext = PineconeRAGService.formatContextForPrompt(context);
		console.log('Retrieved', context.documents.length, 'documents from Pinecone');

		// Get existing chat history
		const chatHistory = getChatHistory(sessionId);

		// Build messages for Cohere with chat history
		const messages: ChatMessageV2[] = [
			{
				role: 'system' as const,
				content: SYSTEM_PROMPT,
			},
			// Include recent chat history (last 10 exchanges max)
			...chatHistory.slice(-20).filter((msg) => msg.role === 'user' || msg.role === 'assistant'),
			{
				role: 'user' as const,
				content: `**Context from Knowledge Base:**
${formattedContext}

**User Question:**
${message}

Please answer the question based on the context provided. Remember: do not mention sources, tool calls, or how you found the information - just answer naturally.`,
			},
		];

		// Add user message to history
		const userMsg: ChatMessageV2 = { role: 'user', content: message };
		chatHistory.push(userMsg);

		// Track response for history
		let fullResponse = '';

		// Create streaming response
		const stream = new ReadableStream({
			async start(controller) {
				const encoder = new TextEncoder();

				try {
					const chatStream = await cohere.chatStream({
						model: 'command-a-03-2025',
						messages,
					});

					for await (const event of chatStream) {
						if (event.type === 'content-delta') {
							const delta = event.delta as { message?: { content?: { text?: string } } };
							if (delta?.message?.content?.text) {
								fullResponse += delta.message.content.text;
								controller.enqueue(
									encoder.encode(`data: ${JSON.stringify({ chunk: delta.message.content.text })}\n\n`)
								);
							}
						} else if (event.type === 'message-end') {
							// Save assistant response to history
							if (fullResponse) {
								chatHistory.push({ role: 'assistant', content: fullResponse });
								setChatHistory(sessionId, chatHistory);
							}
							controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
						}
					}
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Streaming error';
					console.error('Cohere streaming error:', error);
					controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`));
				} finally {
					controller.close();
				}
			},
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			},
		});
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error('Stream API error:', error);
		return new Response(JSON.stringify({ error: errorMessage }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
