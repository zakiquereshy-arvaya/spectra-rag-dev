// Chat history store with Supabase persistence and in-memory cache
import type { ChatMessageV2 } from 'cohere-ai/api';
import { prepareChatHistory, getTokenUsage } from '$lib/utils/tokens';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';

// Session configuration
const SESSION_CONFIG = {
	maxMessagesPerSession: 100, // Max messages before pruning oldest
	sessionExpiryHours: 24, // Sessions expire after 24 hours (in database)
	cacheExpiryMs: 30 * 60 * 1000, // In-memory cache expires after 30 minutes
	saveDebounceMs: 1000, // Debounce saves to reduce database writes
};

interface CachedSession {
	history: ChatMessageV2[];
	lastActivity: number;
	dirty: boolean; // Needs to be saved to database
}

// In-memory cache for fast access
const sessionCache = new Map<string, CachedSession>();

// Pending save timeouts
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Save session to Supabase database
 */
async function saveToDatabase(sessionId: string, history: ChatMessageV2[]): Promise<void> {
	if (!isSupabaseConfigured()) {
		console.warn('Supabase not configured, skipping database save');
		return;
	}

	try {
		const supabase = getSupabaseClient();
		const now = new Date().toISOString();

		// Prune history before saving
		const prunedHistory =
			history.length > SESSION_CONFIG.maxMessagesPerSession
				? history.slice(-SESSION_CONFIG.maxMessagesPerSession)
				: history;

		const { error } = await supabase.from('chat_sessions').upsert(
			{
				id: sessionId,
				messages: JSON.stringify(prunedHistory),
				updated_at: now,
			},
			{
				onConflict: 'id',
			}
		);

		if (error) {
			console.error('Error saving chat session to Supabase:', error);
		}
	} catch (error) {
		console.error('Failed to save chat session:', error);
	}
}

/**
 * Load session from Supabase database
 */
async function loadFromDatabase(sessionId: string): Promise<ChatMessageV2[] | null> {
	if (!isSupabaseConfigured()) {
		return null;
	}

	try {
		const supabase = getSupabaseClient();

		const { data, error } = await supabase
			.from('chat_sessions')
			.select('messages, updated_at')
			.eq('id', sessionId)
			.single();

		if (error) {
			if (error.code !== 'PGRST116') {
				// PGRST116 = not found, which is expected for new sessions
				console.error('Error loading chat session from Supabase:', error);
			}
			return null;
		}

		if (data) {
			// Check if session has expired
			const updatedAt = new Date(data.updated_at).getTime();
			const expiryTime = SESSION_CONFIG.sessionExpiryHours * 60 * 60 * 1000;
			if (Date.now() - updatedAt > expiryTime) {
				// Session expired, delete it
				await deleteFromDatabase(sessionId);
				return null;
			}

			return JSON.parse(data.messages) as ChatMessageV2[];
		}

		return null;
	} catch (error) {
		console.error('Failed to load chat session:', error);
		return null;
	}
}

/**
 * Delete session from database
 */
async function deleteFromDatabase(sessionId: string): Promise<void> {
	if (!isSupabaseConfigured()) {
		return;
	}

	try {
		const supabase = getSupabaseClient();
		await supabase.from('chat_sessions').delete().eq('id', sessionId);
	} catch (error) {
		console.error('Failed to delete chat session:', error);
	}
}

/**
 * Schedule a debounced save to database
 */
function scheduleSave(sessionId: string): void {
	// Clear any existing pending save
	const existing = pendingSaves.get(sessionId);
	if (existing) {
		clearTimeout(existing);
	}

	// Schedule new save
	const timeout = setTimeout(async () => {
		pendingSaves.delete(sessionId);
		const cached = sessionCache.get(sessionId);
		if (cached && cached.dirty) {
			await saveToDatabase(sessionId, cached.history);
			cached.dirty = false;
		}
	}, SESSION_CONFIG.saveDebounceMs);

	pendingSaves.set(sessionId, timeout);
}

/**
 * Get chat history for a session
 * First checks cache, then loads from database if needed
 */
export async function getChatHistoryAsync(sessionId: string): Promise<ChatMessageV2[]> {
	// Check cache first
	const cached = sessionCache.get(sessionId);
	if (cached) {
		cached.lastActivity = Date.now();
		return cached.history;
	}

	// Load from database
	const dbHistory = await loadFromDatabase(sessionId);
	if (dbHistory) {
		sessionCache.set(sessionId, {
			history: dbHistory,
			lastActivity: Date.now(),
			dirty: false,
		});
		return dbHistory;
	}

	return [];
}

/**
 * Get chat history synchronously (from cache only)
 * Falls back to empty array if not in cache
 * Use getChatHistoryAsync when you need to load from database
 */
export function getChatHistory(sessionId: string): ChatMessageV2[] {
	const cached = sessionCache.get(sessionId);
	if (cached) {
		cached.lastActivity = Date.now();
		return cached.history;
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
 * Updates cache and schedules database save
 */
export function setChatHistory(sessionId: string, history: ChatMessageV2[]): void {
	// Prune if exceeding max messages
	const prunedHistory =
		history.length > SESSION_CONFIG.maxMessagesPerSession
			? history.slice(-SESSION_CONFIG.maxMessagesPerSession)
			: history;

	sessionCache.set(sessionId, {
		history: prunedHistory,
		lastActivity: Date.now(),
		dirty: true,
	});

	// Schedule debounced save to database
	scheduleSave(sessionId);
}

/**
 * Add a message to chat history
 */
export function addToChatHistory(sessionId: string, message: ChatMessageV2): void {
	let cached = sessionCache.get(sessionId);

	if (!cached) {
		cached = { history: [], lastActivity: Date.now(), dirty: true };
		sessionCache.set(sessionId, cached);
	}

	cached.history.push(message);
	cached.lastActivity = Date.now();
	cached.dirty = true;

	// Prune if exceeding max messages
	if (cached.history.length > SESSION_CONFIG.maxMessagesPerSession) {
		cached.history = cached.history.slice(-SESSION_CONFIG.maxMessagesPerSession);
	}

	// Schedule debounced save
	scheduleSave(sessionId);
}

/**
 * Add multiple messages to chat history
 */
export function addMessagesToChatHistory(sessionId: string, messages: ChatMessageV2[]): void {
	let cached = sessionCache.get(sessionId);

	if (!cached) {
		cached = { history: [], lastActivity: Date.now(), dirty: true };
		sessionCache.set(sessionId, cached);
	}

	cached.history.push(...messages);
	cached.lastActivity = Date.now();
	cached.dirty = true;

	// Prune if exceeding max messages
	if (cached.history.length > SESSION_CONFIG.maxMessagesPerSession) {
		cached.history = cached.history.slice(-SESSION_CONFIG.maxMessagesPerSession);
	}

	// Schedule debounced save
	scheduleSave(sessionId);
}

/**
 * Clear chat history for a session
 */
export async function clearChatHistory(sessionId: string): Promise<void> {
	// Clear from cache
	sessionCache.delete(sessionId);

	// Cancel any pending save
	const pending = pendingSaves.get(sessionId);
	if (pending) {
		clearTimeout(pending);
		pendingSaves.delete(sessionId);
	}

	// Delete from database
	await deleteFromDatabase(sessionId);
}

/**
 * Get token usage info for a session's chat history
 */
export function getChatHistoryTokenUsage(sessionId: string, model: string = 'command-a-03-2025') {
	const history = getChatHistory(sessionId);
	return getTokenUsage(history, model);
}

/**
 * Get all session IDs (from cache only)
 */
export function getAllSessionIds(): string[] {
	return Array.from(sessionCache.keys());
}

/**
 * Clear all chat histories from cache
 * Note: Does not delete from database
 */
export function clearAllChatHistories(): void {
	sessionCache.clear();
	// Cancel all pending saves
	for (const timeout of pendingSaves.values()) {
		clearTimeout(timeout);
	}
	pendingSaves.clear();
}

/**
 * Get the number of active sessions in cache
 */
export function getActiveSessionCount(): number {
	return sessionCache.size;
}

/**
 * Get session info for debugging
 */
export function getSessionInfo(
	sessionId: string
): { messageCount: number; lastActivity: Date; dirty: boolean } | null {
	const cached = sessionCache.get(sessionId);
	if (!cached) return null;

	return {
		messageCount: cached.history.length,
		lastActivity: new Date(cached.lastActivity),
		dirty: cached.dirty,
	};
}

/**
 * Force save all dirty sessions to database
 * Useful before server shutdown
 */
export async function flushAllSessions(): Promise<void> {
	const savePromises: Promise<void>[] = [];

	for (const [sessionId, cached] of sessionCache.entries()) {
		if (cached.dirty) {
			savePromises.push(saveToDatabase(sessionId, cached.history));
			cached.dirty = false;
		}
	}

	// Cancel all pending saves since we're saving now
	for (const timeout of pendingSaves.values()) {
		clearTimeout(timeout);
	}
	pendingSaves.clear();

	await Promise.all(savePromises);
}

/**
 * Clean up expired sessions from database
 * Should be called periodically (e.g., via cron job or on app startup)
 */
export async function cleanupExpiredSessions(): Promise<number> {
	if (!isSupabaseConfigured()) {
		return 0;
	}

	try {
		const supabase = getSupabaseClient();
		const expiryDate = new Date(
			Date.now() - SESSION_CONFIG.sessionExpiryHours * 60 * 60 * 1000
		).toISOString();

		const { data, error } = await supabase
			.from('chat_sessions')
			.delete()
			.lt('updated_at', expiryDate)
			.select('id');

		if (error) {
			console.error('Error cleaning up expired sessions:', error);
			return 0;
		}

		const cleaned = data?.length || 0;
		if (cleaned > 0) {
			console.log(`Cleaned up ${cleaned} expired chat sessions from database`);
		}
		return cleaned;
	} catch (error) {
		console.error('Failed to cleanup expired sessions:', error);
		return 0;
	}
}

/**
 * Preload a session from database into cache
 * Call this when a user starts a new conversation
 */
export async function preloadSession(sessionId: string): Promise<void> {
	if (sessionCache.has(sessionId)) {
		return; // Already in cache
	}

	const history = await loadFromDatabase(sessionId);
	if (history) {
		sessionCache.set(sessionId, {
			history,
			lastActivity: Date.now(),
			dirty: false,
		});
	}
}
