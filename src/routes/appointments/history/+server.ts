import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getChatHistory, clearChatHistory } from '$lib/services/chat-history-store';

/**
 * GET /appointments/history?sessionId=xxx
 * Fetch chat history for a session from server
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const session = await locals.auth();

	if (!session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const sessionId = url.searchParams.get('sessionId');

	if (!sessionId) {
		return json({ error: 'sessionId is required' }, { status: 400 });
	}

	try {
		const history = getChatHistory(sessionId);

		// Convert to client format
		const messages = history
			.filter((msg) => msg.role === 'user' || msg.role === 'assistant')
			.map((msg) => ({
				role: msg.role as 'user' | 'assistant',
				content: typeof msg.content === 'string' ? msg.content : '',
				timestamp: new Date().toISOString(),
			}));

		return json({ messages });
	} catch (error) {
		console.error('Error fetching chat history:', error);
		return json({ error: 'Failed to fetch history' }, { status: 500 });
	}
};

/**
 * DELETE /appointments/history?sessionId=xxx
 * Clear chat history for a session
 */
export const DELETE: RequestHandler = async ({ url, locals }) => {
	const session = await locals.auth();

	if (!session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const sessionId = url.searchParams.get('sessionId');

	if (!sessionId) {
		return json({ error: 'sessionId is required' }, { status: 400 });
	}

	try {
		clearChatHistory(sessionId);
		return json({ success: true });
	} catch (error) {
		console.error('Error clearing chat history:', error);
		return json({ error: 'Failed to clear history' }, { status: 500 });
	}
};
