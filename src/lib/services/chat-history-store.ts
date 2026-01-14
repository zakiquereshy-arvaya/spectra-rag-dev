// Supabase-backed chat history store with automatic cleanup
// Replaces in-memory storage to work properly on serverless (Vercel)

import type { ChatMessageV2 } from 'cohere-ai/api';
import { prepareChatHistory, getTokenUsage } from '$lib/utils/tokens';
import { getSupabaseClient } from './supabase';

// Session configuration
const SESSION_CONFIG = {
	maxMessagesPerSession: 100, // Max messages before pruning oldest
	sessionExpiryHours: 24, // Sessions older than this will be cleaned up
};

/**
 * Get chat history for a session from Supabase
 */
export async function getChatHistoryAsync(sessionId: string): Promise<ChatMessageV2[]> {
	try {
		const supabase = getSupabaseClient();
		const { data, error } = await supabase
			.from('chat_sessions')
			.select('messages')
			.eq('id', sessionId)
			.single();

		if (error) {
			if (error.code === 'PGRST116') {
				// No rows found - return empty array
				return [];
			}
			console.error('Error fetching chat history:', error);
			return [];
		}

		return (data?.messages as ChatMessageV2[]) || [];
	} catch (error) {
		console.error('Error in getChatHistoryAsync:', error);
		return [];
	}
}

/**
 * Synchronous version - returns empty, use async version instead
 * @deprecated Use getChatHistoryAsync instead
 */
export function getChatHistory(sessionId: string): ChatMessageV2[] {
	// For backwards compatibility during transition
	// The MCP server should be updated to use async version
	console.warn(`getChatHistory called synchronously for ${sessionId} - returning empty. Use getChatHistoryAsync.`);
	return [];
}

/**
 * Get chat history prepared for API call (truncated if needed)
 */
export async function getPreparedChatHistoryAsync(
	sessionId: string,
	model: string = 'command-a-03-2025'
): Promise<ChatMessageV2[]> {
	const history = await getChatHistoryAsync(sessionId);
	return prepareChatHistory(history, model);
}

/**
 * Set chat history for a session in Supabase (upsert)
 */
export async function setChatHistoryAsync(sessionId: string, history: ChatMessageV2[]): Promise<void> {
	try {
		const supabase = getSupabaseClient();

		// Prune if exceeding max messages
		const prunedHistory =
			history.length > SESSION_CONFIG.maxMessagesPerSession
				? history.slice(-SESSION_CONFIG.maxMessagesPerSession)
				: history;

		const { error } = await supabase
			.from('chat_sessions')
			.upsert(
				{
					id: sessionId,
					messages: prunedHistory,
					updated_at: new Date().toISOString(),
				},
				{
					onConflict: 'id',
				}
			);

		if (error) {
			console.error('Error saving chat history:', error);
			throw error;
		}
	} catch (error) {
		console.error('Error in setChatHistoryAsync:', error);
		throw error;
	}
}

/**
 * Synchronous version - no-op, use async version
 * @deprecated Use setChatHistoryAsync instead
 */
export function setChatHistory(sessionId: string, history: ChatMessageV2[]): void {
	// Fire and forget - call async version
	setChatHistoryAsync(sessionId, history).catch((err) => {
		console.error('Error in setChatHistory fire-and-forget:', err);
	});
}

/**
 * Add a message to chat history
 */
export async function addToChatHistoryAsync(sessionId: string, message: ChatMessageV2): Promise<void> {
	const history = await getChatHistoryAsync(sessionId);
	history.push(message);
	await setChatHistoryAsync(sessionId, history);
}

/**
 * Add multiple messages to chat history
 */
export async function addMessagesToChatHistoryAsync(sessionId: string, messages: ChatMessageV2[]): Promise<void> {
	const history = await getChatHistoryAsync(sessionId);
	history.push(...messages);
	await setChatHistoryAsync(sessionId, history);
}

/**
 * Clear chat history for a session
 */
export async function clearChatHistoryAsync(sessionId: string): Promise<void> {
	try {
		const supabase = getSupabaseClient();
		const { error } = await supabase
			.from('chat_sessions')
			.delete()
			.eq('id', sessionId);

		if (error) {
			console.error('Error clearing chat history:', error);
			throw error;
		}
	} catch (error) {
		console.error('Error in clearChatHistoryAsync:', error);
		throw error;
	}
}

/**
 * Synchronous version for backwards compatibility
 * @deprecated Use clearChatHistoryAsync instead
 */
export function clearChatHistory(sessionId: string): void {
	clearChatHistoryAsync(sessionId).catch((err) => {
		console.error('Error in clearChatHistory:', err);
	});
}

/**
 * Clean up expired sessions (older than sessionExpiryHours)
 * Call this periodically or on each request
 */
export async function cleanupExpiredSessions(): Promise<number> {
	try {
		const supabase = getSupabaseClient();
		const expiryDate = new Date();
		expiryDate.setHours(expiryDate.getHours() - SESSION_CONFIG.sessionExpiryHours);

		const { data, error } = await supabase
			.from('chat_sessions')
			.delete()
			.lt('updated_at', expiryDate.toISOString())
			.select('id');

		if (error) {
			console.error('Error cleaning up expired sessions:', error);
			return 0;
		}

		const cleaned = data?.length || 0;
		if (cleaned > 0) {
			console.log(`Cleaned up ${cleaned} expired chat sessions`);
		}
		return cleaned;
	} catch (error) {
		console.error('Error in cleanupExpiredSessions:', error);
		return 0;
	}
}

/**
 * Get token usage info for a session's chat history
 */
export async function getChatHistoryTokenUsageAsync(sessionId: string, model: string = 'command-a-03-2025') {
	const history = await getChatHistoryAsync(sessionId);
	return getTokenUsage(history, model);
}

/**
 * Get the number of active sessions
 */
export async function getActiveSessionCountAsync(): Promise<number> {
	try {
		const supabase = getSupabaseClient();
		const { count, error } = await supabase
			.from('chat_sessions')
			.select('*', { count: 'exact', head: true });

		if (error) {
			console.error('Error getting session count:', error);
			return 0;
		}

		return count || 0;
	} catch (error) {
		console.error('Error in getActiveSessionCountAsync:', error);
		return 0;
	}
}

/**
 * Get session info for debugging
 */
export async function getSessionInfoAsync(sessionId: string): Promise<{ messageCount: number; lastActivity: Date } | null> {
	try {
		const supabase = getSupabaseClient();
		const { data, error } = await supabase
			.from('chat_sessions')
			.select('messages, updated_at')
			.eq('id', sessionId)
			.single();

		if (error || !data) {
			return null;
		}

		return {
			messageCount: (data.messages as any[])?.length || 0,
			lastActivity: new Date(data.updated_at),
		};
	} catch (error) {
		console.error('Error in getSessionInfoAsync:', error);
		return null;
	}
}

/**
 * Preload session - ensures session exists in DB
 */
export async function preloadSession(sessionId: string): Promise<void> {
	const history = await getChatHistoryAsync(sessionId);
	if (history.length === 0) {
		// Session doesn't exist, create empty one
		await setChatHistoryAsync(sessionId, []);
	}
}

// ============================================================================
// Legacy exports for backwards compatibility
// ============================================================================

export const CHAT_KEYS = {
	appointments: 'chat-appointments-messages',
	billi: 'chat-billi-messages',
	spectraJob: 'chat-spectra-job-messages',
} as const;

/** @deprecated Use getChatHistoryAsync instead */
export function loadMessages(): ChatMessageV2[] {
	return [];
}

/** @deprecated Messages are now stored in Supabase */
export function saveMessages(): boolean {
	return true;
}

/** @deprecated Use clearChatHistoryAsync instead */
export function clearMessages(): void {
	// No-op
}

/** @deprecated Use getActiveSessionCountAsync */
export function getActiveSessionCount(): number {
	return 0;
}

/** @deprecated */
export function getAllSessionIds(): string[] {
	return [];
}

/** @deprecated */
export function clearAllChatHistories(): void {
	// No-op - use cleanupExpiredSessions instead
}

/** @deprecated */
export function getSessionInfo(): null {
	return null;
}

/** @deprecated Use getPreparedChatHistoryAsync */
export function getPreparedChatHistory(
	sessionId: string,
	model: string = 'command-a-03-2025'
): ChatMessageV2[] {
	console.warn('getPreparedChatHistory called synchronously - returning empty. Use getPreparedChatHistoryAsync.');
	return [];
}

/** @deprecated */
export function addToChatHistory(): void {
	// No-op
}

/** @deprecated */
export function addMessagesToChatHistory(): void {
	// No-op
}

/** @deprecated */
export function getChatHistoryTokenUsage() {
	return { estimatedTokens: 0, messageCount: 0 };
}
