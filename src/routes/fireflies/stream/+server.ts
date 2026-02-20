// Fireflies Stream endpoint - RAG-powered meeting transcript Q&A
import type { RequestHandler } from './$types';
import { FirefliesAgent } from '$lib/services/fireflies-agent';
import { logEvent } from '$lib/services/ops-logger';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async (event) => {
	const session = await event.locals.auth();

	if (!session) {
		return new Response('Unauthorized', { status: 401 });
	}

	if (!env.COHERE_API_KEY) {
		return new Response('Cohere API key not configured', { status: 500 });
	}

	if (!env.VECTOR_DATABASE_URL) {
		return new Response('Vector database URL not configured', { status: 500 });
	}

	try {
		const body = await event.request.json();
		const { message, sessionId } = body;

		if (!message) {
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
			route: '/fireflies/stream',
			metadata: { sessionId, messageLength: message.length },
		});

		// Create Fireflies Agent
		const agent = new FirefliesAgent({
			cohereApiKey: env.COHERE_API_KEY,
			databaseUrl: env.VECTOR_DATABASE_URL,
			sessionId: sessionId || 'default',
		});

		// Create streaming response
		const stream = new ReadableStream({
			async start(controller) {
				const encoder = new TextEncoder();

				try {
					for await (const chunk of agent.handleRequestStream({ message })) {
						if (chunk.type === 'text' && chunk.content) {
							controller.enqueue(
								encoder.encode(`data: ${JSON.stringify({ chunk: chunk.content })}\n\n`)
							);
						} else if (chunk.type === 'sources' && chunk.sources) {
							controller.enqueue(
								encoder.encode(`data: ${JSON.stringify({ sources: chunk.sources })}\n\n`)
							);
						} else if (chunk.type === 'suggestions' && chunk.suggestions) {
							controller.enqueue(
								encoder.encode(`data: ${JSON.stringify({ suggestions: chunk.suggestions })}\n\n`)
							);
						} else if (chunk.type === 'error') {
							controller.enqueue(
								encoder.encode(`data: ${JSON.stringify({ error: chunk.error })}\n\n`)
							);
						} else if (chunk.type === 'done') {
							controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
						}
					}
				} catch (error: any) {
					console.error('[Fireflies Stream] Error:', error);
					controller.enqueue(
						encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`)
					);
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
	} catch (error: any) {
		console.error('[Fireflies Stream] API error:', error);
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
