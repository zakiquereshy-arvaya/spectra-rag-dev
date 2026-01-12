// In-memory chat history store per session with token management
import type { ChatMessageV2 } from 'cohere-ai/api';
import { prepareChatHistory, getTokenUsage } from '$lib/utils/tokens';

const chatHistories = new Map<string, ChatMessageV2[]>();

/**
 * Get chat history for a session
 * Returns the full history (may need truncation before API call)
 */
export function getChatHistory(sessionId: string): ChatMessageV2[] {
	return chatHistories.get(sessionId) || [];
}

/**
 * Get chat history prepared for API call (truncated if needed)
 */
export function getPreparedChatHistory(sessionId: string, model: string = 'command-a-03-2025'): ChatMessageV2[] {
	const history = getChatHistory(sessionId);
	return prepareChatHistory(history, model);
}

/**
 * Set chat history for a session
 */
export function setChatHistory(sessionId: string, history: ChatMessageV2[]): void {
	chatHistories.set(sessionId, history);
}

/**
 * Add a message to chat history
 */
export function addToChatHistory(sessionId: string, message: ChatMessageV2): void {
	const history = getChatHistory(sessionId);
	history.push(message);
	chatHistories.set(sessionId, history);
}

/**
 * Add multiple messages to chat history
 */
export function addMessagesToChatHistory(sessionId: string, messages: ChatMessageV2[]): void {
	const history = getChatHistory(sessionId);
	history.push(...messages);
	chatHistories.set(sessionId, history);
}

/**
 * Clear chat history for a session
 */
export function clearChatHistory(sessionId: string): void {
	chatHistories.delete(sessionId);
}

/**
 * Get token usage info for a session's chat history
 */
export function getChatHistoryTokenUsage(sessionId: string, model: string = 'command-a-03-2025') {
	const history = getChatHistory(sessionId);
	return getTokenUsage(history, model);
}

/**
 * Get all session IDs
 */
export function getAllSessionIds(): string[] {
	return Array.from(chatHistories.keys());
}

/**
 * Clear all chat histories (useful for cleanup)
 */
export function clearAllChatHistories(): void {
	chatHistories.clear();
}

/**
 * Get the number of active sessions
 */
export function getActiveSessionCount(): number {
	return chatHistories.size;
}
