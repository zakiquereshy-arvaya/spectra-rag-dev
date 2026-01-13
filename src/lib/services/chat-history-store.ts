// In-memory chat history store per session with token management and auto-cleanup
import type { ChatMessageV2 } from 'cohere-ai/api';
import { prepareChatHistory, getTokenUsage } from '$lib/utils/tokens';

// Session configuration
const SESSION_CONFIG = {
	maxMessagesPerSession: 100, // Max messages before pruning oldest
	sessionExpiryMs: 2 * 60 * 60 * 1000, // 2 hours of inactivity
	cleanupIntervalMs: 10 * 60 * 1000, // Run cleanup every 10 minutes
};

interface SessionData {
	history: ChatMessageV2[];
	lastActivity: number;
}

const chatSessions = new Map<string, SessionData>();

// Cleanup interval reference
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the automatic cleanup interval
 */
function startCleanupInterval(): void {
	if (cleanupInterval) return;

	cleanupInterval = setInterval(() => {
		cleanupExpiredSessions();
	}, SESSION_CONFIG.cleanupIntervalMs);

	// Don't prevent Node from exiting
	if (cleanupInterval.unref) {
		cleanupInterval.unref();
	}
}

/**
 * Remove expired sessions based on last activity time
 */
export function cleanupExpiredSessions(): number {
	const now = Date.now();
	let cleaned = 0;

	for (const [sessionId, session] of chatSessions.entries()) {
		if (now - session.lastActivity > SESSION_CONFIG.sessionExpiryMs) {
			chatSessions.delete(sessionId);
			cleaned++;
		}
	}

	if (cleaned > 0) {
		console.log(`Cleaned up ${cleaned} expired chat sessions`);
	}

	return cleaned;
}

/**
 * Update last activity timestamp for a session
 */
function touchSession(sessionId: string): void {
	const session = chatSessions.get(sessionId);
	if (session) {
		session.lastActivity = Date.now();
	}
}

/**
 * Get chat history for a session
 * Returns the full history (may need truncation before API call)
 */
export function getChatHistory(sessionId: string): ChatMessageV2[] {
	const session = chatSessions.get(sessionId);
	if (session) {
		touchSession(sessionId);
		return session.history;
	}
	return [];
}

/**
 * Get chat history prepared for API call (truncated if needed)
 */
export function getPreparedChatHistory(
	sessionId: string,
	model: string = 'command-a-03-2025'
): ChatMessageV2[] {
	const history = getChatHistory(sessionId);
	return prepareChatHistory(history, model);
}

/**
 * Set chat history for a session
 */
export function setChatHistory(sessionId: string, history: ChatMessageV2[]): void {
	// Prune if exceeding max messages
	const prunedHistory =
		history.length > SESSION_CONFIG.maxMessagesPerSession
			? history.slice(-SESSION_CONFIG.maxMessagesPerSession)
			: history;

	chatSessions.set(sessionId, {
		history: prunedHistory,
		lastActivity: Date.now(),
	});

	// Ensure cleanup is running
	startCleanupInterval();
}

/**
 * Add a message to chat history
 */
export function addToChatHistory(sessionId: string, message: ChatMessageV2): void {
	let session = chatSessions.get(sessionId);

	if (!session) {
		session = { history: [], lastActivity: Date.now() };
		chatSessions.set(sessionId, session);
	}

	session.history.push(message);
	session.lastActivity = Date.now();

	// Prune if exceeding max messages
	if (session.history.length > SESSION_CONFIG.maxMessagesPerSession) {
		session.history = session.history.slice(-SESSION_CONFIG.maxMessagesPerSession);
	}

	// Ensure cleanup is running
	startCleanupInterval();
}

/**
 * Add multiple messages to chat history
 */
export function addMessagesToChatHistory(sessionId: string, messages: ChatMessageV2[]): void {
	let session = chatSessions.get(sessionId);

	if (!session) {
		session = { history: [], lastActivity: Date.now() };
		chatSessions.set(sessionId, session);
	}

	session.history.push(...messages);
	session.lastActivity = Date.now();

	// Prune if exceeding max messages
	if (session.history.length > SESSION_CONFIG.maxMessagesPerSession) {
		session.history = session.history.slice(-SESSION_CONFIG.maxMessagesPerSession);
	}

	// Ensure cleanup is running
	startCleanupInterval();
}

/**
 * Clear chat history for a session
 */
export function clearChatHistory(sessionId: string): void {
	chatSessions.delete(sessionId);
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
	return Array.from(chatSessions.keys());
}

/**
 * Clear all chat histories (useful for cleanup)
 */
export function clearAllChatHistories(): void {
	chatSessions.clear();
}

/**
 * Get the number of active sessions
 */
export function getActiveSessionCount(): number {
	return chatSessions.size;
}

/**
 * Get session info for debugging
 */
export function getSessionInfo(sessionId: string): { messageCount: number; lastActivity: Date } | null {
	const session = chatSessions.get(sessionId);
	if (!session) return null;

	return {
		messageCount: session.history.length,
		lastActivity: new Date(session.lastActivity),
	};
}
