import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CohereClientV2 } from 'cohere-ai';
import { RAG_SYSTEM_PROMPT, RAG_VALIDATION_PROMPT } from '$lib/services/rag-prompts';
import { RagRetrievalService } from '$lib/services/rag-retrieval';
import { getRagConfig } from '$lib/services/rag-config';
import { logEvent } from '$lib/services/ops-logger';
import { COHERE_API_KEY, VECTOR_DATABASE_URL } from '$env/static/private';

export const POST: RequestHandler = async (event) => {
	const session = await event.locals.auth();
	if (!session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	if (!COHERE_API_KEY || !VECTOR_DATABASE_URL) {
		return json({ error: 'Missing COHERE_API_KEY or VECTOR_DATABASE_URL' }, { status: 500 });
	}

	try {
		const body = await event.request.json();
		const { question, filters } = body as {
			question?: string;
			filters?: Record<string, string>;
		};

		if (!question || typeof question !== 'string') {
			return json({ error: 'question is required' }, { status: 400 });
		}

		logEvent({
			user_email: session.user?.email ?? undefined,
			user_name: session.user?.name ?? undefined,
			event_type: 'rag_query',
			event_action: 'ask',
			route: '/rag/ask',
			metadata: { questionLength: question.length, hasFilters: !!filters },
		});

		const retrieval = new RagRetrievalService(
			VECTOR_DATABASE_URL,
			COHERE_API_KEY,
			getRagConfig()
		);
		const { context, sources, chunks } = await retrieval.retrieve(question, filters || {}, session.user?.email ?? undefined);

		if (!context || chunks.length === 0) {
			return json({
				answer: "I don't know based on the provided documents.",
				sources: [],
			});
		}

		const cohere = new CohereClientV2({ token: COHERE_API_KEY });
		const messages = [
			{ role: 'system', content: RAG_SYSTEM_PROMPT },
			{ role: 'system', content: `Context:\n${context}` },
			{ role: 'user', content: question },
		];

		const response = await cohere.chat({
			model: 'command-a-03-2025',
			messages,
		});

		const rawText =
			typeof response.message?.content === 'string'
				? response.message.content
				: Array.isArray(response.message?.content)
					? response.message.content
							.filter((item: any) => item.type === 'text')
							.map((item: any) => item.text)
							.join('')
					: '';

		let answer = rawText.trim() || "I don't know based on the provided documents.";

		if (process.env.RAG_VALIDATE === 'true') {
			const validationMessages = [
				{ role: 'system', content: RAG_VALIDATION_PROMPT },
				{ role: 'system', content: `Context:\n${context}` },
				{ role: 'user', content: `Draft answer:\n${answer}` },
			];

			const validation = await cohere.chat({
				model: 'command-a-03-2025',
				messages: validationMessages,
			});

			const validatedText =
				typeof validation.message?.content === 'string'
					? validation.message.content
					: Array.isArray(validation.message?.content)
						? validation.message.content
								.filter((item: any) => item.type === 'text')
								.map((item: any) => item.text)
								.join('')
						: '';

			if (validatedText.trim()) {
				answer = validatedText.trim();
			}
		}

		return json({ answer, sources });
	} catch (error: any) {
		console.error('[RAG Ask] Error:', error);
		return json({ error: error.message || 'Internal error' }, { status: 500 });
	}
};
