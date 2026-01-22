// Session ID management - server-side chat history storage
// Messages are stored on the server, only sessionId is persisted client-side

import type { ChatMessage } from '$lib/api/chat';

// Keys for session IDs per chat section
const SESSION_KEYS = {
	appointments: 'session-appointments-id',
	billi: 'session-billi-id',
	spectraJob: 'session-spectra-job-id',
	moe: 'session-moe-id',
	fireflies: 'session-fireflies-id',
} as const;

export type ChatKey = keyof typeof SESSION_KEYS;

/**
 * Get or create a session ID for a chat section
 * Uses sessionStorage so it's cleared when browser closes
 */
export function getSessionId(chatKey: ChatKey): string {
	if (typeof window === 'undefined') {
		return crypto.randomUUID();
	}

	try {
		const stored = sessionStorage.getItem(SESSION_KEYS[chatKey]);
		if (stored) {
			return stored;
		}

		// Generate new session ID
		const newId = crypto.randomUUID();
		sessionStorage.setItem(SESSION_KEYS[chatKey], newId);
		return newId;
	} catch {
		// Fallback if sessionStorage fails
		return crypto.randomUUID();
	}
}

/**
 * Clear session ID for a chat section (starts a new conversation)
 */
export function clearSessionId(chatKey: ChatKey): void {
	if (typeof window === 'undefined') return;

	try {
		sessionStorage.removeItem(SESSION_KEYS[chatKey]);
	} catch (error) {
		console.error(`Error clearing session for ${chatKey}:`, error);
	}
}

/**
 * Fetch chat history from server
 */
export async function fetchChatHistory(
	chatKey: ChatKey,
	sessionId: string
): Promise<ChatMessage[]> {
	if (typeof window === 'undefined') {
		return [];
	}

	try {
		const endpoint =
			chatKey === 'appointments'
				? '/appointments/history'
				: chatKey === 'spectraJob'
					? '/spectra-job/history'
					: chatKey === 'moe'
						? '/moe/history'
						: chatKey === 'fireflies'
							? '/fireflies/history'
							: '/billi/history';

		const response = await fetch(`${endpoint}?sessionId=${encodeURIComponent(sessionId)}`);

		if (!response.ok) {
			console.warn(`Failed to fetch history for ${chatKey}: ${response.status}`);
			return [];
		}

		const data = await response.json();
		return data.messages || [];
	} catch (error) {
		console.error(`Error fetching chat history for ${chatKey}:`, error);
		return [];
	}
}

/**
 * Clear chat history on server
 */
export async function clearServerHistory(chatKey: ChatKey, sessionId: string): Promise<boolean> {
	if (typeof window === 'undefined') {
		return false;
	}

	try {
		const endpoint =
			chatKey === 'appointments'
				? '/appointments/history'
				: chatKey === 'spectraJob'
					? '/spectra-job/history'
					: chatKey === 'moe'
						? '/moe/history'
						: chatKey === 'fireflies'
							? '/fireflies/history'
							: '/billi/history';

		const response = await fetch(`${endpoint}?sessionId=${encodeURIComponent(sessionId)}`, {
			method: 'DELETE',
		});

		return response.ok;
	} catch (error) {
		console.error(`Error clearing server history for ${chatKey}:`, error);
		return false;
	}
}

// ============================================================================
// Legacy exports for backwards compatibility during migration
// These will be removed once all pages are updated
// ============================================================================

export const CHAT_KEYS = {
	appointments: 'chat-appointments-messages',
	billi: 'chat-billi-messages',
	spectraJob: 'chat-spectra-job-messages',
} as const;

/** @deprecated Use fetchChatHistory instead */
export function loadMessages(_chatKey: ChatKey): ChatMessage[] {
	// Return empty - messages now come from server
	return [];
}

/** @deprecated Messages are now stored on server */
export function saveMessages(_chatKey: ChatKey, _messages: ChatMessage[]): boolean {
	// No-op - server handles persistence
	return true;
}

/** @deprecated Use clearServerHistory instead */
export function clearMessages(chatKey: ChatKey): void {
	clearSessionId(chatKey);
}
