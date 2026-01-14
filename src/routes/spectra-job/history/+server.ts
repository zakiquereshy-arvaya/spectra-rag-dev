import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getChatHistoryAsync, clearChatHistoryAsync, cleanupExpiredSessions } from '$lib/services/chat-history-store';

/**
 * GET /spectra-job/history?sessionId=xxx
 * Fetch chat history for a session from Supabase
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
		// Opportunistically clean up expired sessions (non-blocking)
		cleanupExpiredSessions().catch(() => {});

		const history = await getChatHistoryAsync(sessionId);

		// Convert to client format, using stored timestamps
		const baseTime = Date.now();
		const filteredHistory = history.filter((msg) => msg.role === 'user' || msg.role === 'assistant');
		const messages = filteredHistory.map((msg, index) => ({
			role: msg.role as 'user' | 'assistant',
			content: typeof msg.content === 'string' ? msg.content : '',
			// Use stored timestamp, or generate unique fallback for legacy data
			timestamp: (msg as any)._timestamp || new Date(baseTime + index).toISOString(),
		}));

		return json({ messages });
	} catch (error) {
		console.error('Error fetching chat history:', error);
		return json({ error: 'Failed to fetch history' }, { status: 500 });
	}
};

/**
 * DELETE /spectra-job/history?sessionId=xxx
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
		await clearChatHistoryAsync(sessionId);
		return json({ success: true });
	} catch (error) {
		console.error('Error clearing chat history:', error);
		return json({ error: 'Failed to clear history' }, { status: 500 });
	}
};
