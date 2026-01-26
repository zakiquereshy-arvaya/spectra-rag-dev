// Fireflies History endpoint - Chat history CRUD
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getChatHistoryAsync, clearChatHistoryAsync } from '$lib/services/chat-history-store';

export const GET: RequestHandler = async (event) => {
	const session = await event.locals.auth();

	if (!session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const sessionId = event.url.searchParams.get('sessionId');
	if (!sessionId) {
		return json({ error: 'sessionId is required' }, { status: 400 });
	}

	try {
		const history = await getChatHistoryAsync(sessionId);

		// Transform to frontend format
		const messages = history
			.filter((msg) => msg.role === 'user' || (msg.role === 'assistant' && msg.content))
			.map((msg) => ({
				role: msg.role,
				content:
					typeof msg.content === 'string'
						? msg.content
						: Array.isArray(msg.content)
							? msg.content
									.filter((item: any) => item.type === 'text')
									.map((item: any) => item.text)
									.join('')
							: '',
				timestamp: (msg as any)._timestamp || new Date().toISOString(),
			}));

		return json({ messages });
	} catch (error: any) {
		console.error('[Fireflies History] GET error:', error);
		return json({ error: error.message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	const session = await event.locals.auth();

	if (!session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const sessionId = event.url.searchParams.get('sessionId');
	if (!sessionId) {
		return json({ error: 'sessionId is required' }, { status: 400 });
	}

	try {
		await clearChatHistoryAsync(sessionId);
		return json({ success: true });
	} catch (error: any) {
		console.error('[Fireflies History] DELETE error:', error);
		return json({ error: error.message }, { status: 500 });
	}
};
