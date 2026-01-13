// Chat Persistence Store - Saves conversations to localStorage with automatic pruning
import type { ChatMessage } from '$lib/api/chat';

export interface ChatPersistenceConfig {
	maxMessages: number; // Maximum messages to keep per chat
	maxAge: number; // Maximum age in milliseconds (e.g., 24 hours = 86400000)
	maxMessageLength: number; // Maximum characters per message content
}

const DEFAULT_CONFIG: ChatPersistenceConfig = {
	maxMessages: 30, // Reduced from 50 to prevent quota issues
	maxAge: 24 * 60 * 60 * 1000, // 24 hours
	maxMessageLength: 10000, // Max 10K chars per message to prevent huge responses
};

// Estimated localStorage quota (conservative estimate)
const ESTIMATED_QUOTA_BYTES = 4 * 1024 * 1024; // 4MB conservative limit
const QUOTA_WARNING_THRESHOLD = 0.8; // Warn at 80% usage

// Keys for different chat sections
export const CHAT_KEYS = {
	appointments: 'chat-appointments-messages',
	billi: 'chat-billi-messages',
	spectraJob: 'chat-spectra-job-messages',
} as const;

export type ChatKey = keyof typeof CHAT_KEYS;

/**
 * Get estimated localStorage usage in bytes
 */
function getLocalStorageUsage(): number {
	if (typeof window === 'undefined') return 0;

	let total = 0;
	try {
		for (const key in localStorage) {
			if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
				total += (localStorage[key].length + key.length) * 2; // UTF-16 = 2 bytes per char
			}
		}
	} catch {
		// Ignore errors
	}
	return total;
}

/**
 * Check if localStorage is approaching quota
 */
export function isNearQuota(): boolean {
	const usage = getLocalStorageUsage();
	return usage > ESTIMATED_QUOTA_BYTES * QUOTA_WARNING_THRESHOLD;
}

/**
 * Truncate message content if it exceeds max length
 */
function truncateMessage(message: ChatMessage, maxLength: number): ChatMessage {
	if (message.content.length <= maxLength) {
		return message;
	}
	return {
		...message,
		content: message.content.substring(0, maxLength) + '\n\n[Message truncated due to length...]',
	};
}

/**
 * Clear all chat storage to free space
 */
export function clearAllChatStorage(): void {
	if (typeof window === 'undefined') return;

	try {
		for (const key of Object.values(CHAT_KEYS)) {
			localStorage.removeItem(key);
		}
		console.log('Cleared all chat storage to free space');
	} catch (error) {
		console.error('Error clearing chat storage:', error);
	}
}

/**
 * Load messages from localStorage for a specific chat section
 */
export function loadMessages(chatKey: ChatKey, config: ChatPersistenceConfig = DEFAULT_CONFIG): ChatMessage[] {
	if (typeof window === 'undefined') {
		return [];
	}

	try {
		const stored = localStorage.getItem(CHAT_KEYS[chatKey]);
		if (!stored) {
			return [];
		}

		const messages: ChatMessage[] = JSON.parse(stored);
		const now = Date.now();

		// Filter out messages older than maxAge
		const filteredMessages = messages.filter((msg) => {
			const messageTime = new Date(msg.timestamp).getTime();
			return now - messageTime < config.maxAge;
		});

		// Return only the last maxMessages
		return filteredMessages.slice(-config.maxMessages);
	} catch (error) {
		console.error(`Error loading messages for ${chatKey}:`, error);
		return [];
	}
}

/**
 * Save messages to localStorage for a specific chat section
 * Automatically prunes old messages based on config
 * Handles quota exceeded errors gracefully
 */
export function saveMessages(
	chatKey: ChatKey,
	messages: ChatMessage[],
	config: ChatPersistenceConfig = DEFAULT_CONFIG
): boolean {
	if (typeof window === 'undefined') {
		return false;
	}

	try {
		const now = Date.now();

		// Filter out messages older than maxAge
		const filteredMessages = messages.filter((msg) => {
			const messageTime = new Date(msg.timestamp).getTime();
			return now - messageTime < config.maxAge;
		});

		// Truncate individual messages that are too long
		const truncatedMessages = filteredMessages.map((msg) =>
			truncateMessage(msg, config.maxMessageLength)
		);

		// Keep only the last maxMessages
		const prunedMessages = truncatedMessages.slice(-config.maxMessages);

		// Check if we're near quota before saving
		if (isNearQuota()) {
			console.warn('localStorage near quota, reducing stored messages');
			// Keep fewer messages when near quota
			const reducedMessages = prunedMessages.slice(-Math.floor(config.maxMessages / 2));
			localStorage.setItem(CHAT_KEYS[chatKey], JSON.stringify(reducedMessages));
		} else {
			localStorage.setItem(CHAT_KEYS[chatKey], JSON.stringify(prunedMessages));
		}

		return true;
	} catch (error: unknown) {
		// Handle quota exceeded error
		if (
			error instanceof Error &&
			(error.name === 'QuotaExceededError' ||
				error.message.includes('quota') ||
				error.message.includes('storage'))
		) {
			console.warn('localStorage quota exceeded, clearing old data');
			try {
				// Clear this chat's storage and try again with minimal messages
				localStorage.removeItem(CHAT_KEYS[chatKey]);
				const minimalMessages = messages.slice(-5).map((msg) =>
					truncateMessage(msg, config.maxMessageLength)
				);
				localStorage.setItem(CHAT_KEYS[chatKey], JSON.stringify(minimalMessages));
				return true;
			} catch {
				// If still failing, clear all chat storage
				clearAllChatStorage();
				return false;
			}
		}
		console.error(`Error saving messages for ${chatKey}:`, error);
		return false;
	}
}

/**
 * Clear all messages for a specific chat section
 */
export function clearMessages(chatKey: ChatKey): void {
	if (typeof window === 'undefined') {
		return;
	}

	try {
		localStorage.removeItem(CHAT_KEYS[chatKey]);
	} catch (error) {
		console.error(`Error clearing messages for ${chatKey}:`, error);
	}
}

/**
 * Add a single message and save (convenience function)
 */
export function addAndSaveMessage(
	chatKey: ChatKey,
	currentMessages: ChatMessage[],
	newMessage: ChatMessage,
	config: ChatPersistenceConfig = DEFAULT_CONFIG
): ChatMessage[] {
	const updatedMessages = [...currentMessages, newMessage];
	saveMessages(chatKey, updatedMessages, config);
	return updatedMessages;
}

/**
 * Get chat history formatted for Cohere API
 * Returns messages in Cohere's expected format with automatic context window management
 */
export function getMessagesForCohere(
	chatKey: ChatKey,
	maxTokenEstimate: number = 10000 // Rough token limit for context
): Array<{ role: 'user' | 'assistant'; content: string }> {
	const messages = loadMessages(chatKey);

	// Rough estimate: 4 characters = 1 token
	const charLimit = maxTokenEstimate * 4;
	let totalChars = 0;
	const result: Array<{ role: 'user' | 'assistant'; content: string }> = [];

	// Start from newest messages
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		const msgChars = msg.content.length;

		if (totalChars + msgChars > charLimit) {
			break;
		}

		totalChars += msgChars;
		result.unshift({
			role: msg.role as 'user' | 'assistant',
			content: msg.content,
		});
	}

	return result;
}

/**
 * Create a reactive chat store for Svelte 5
 * Usage: const chat = createChatStore('appointments');
 */
export function createChatStore(chatKey: ChatKey, config: ChatPersistenceConfig = DEFAULT_CONFIG) {
	return {
		load: () => loadMessages(chatKey, config),
		save: (messages: ChatMessage[]) => saveMessages(chatKey, messages, config),
		clear: () => clearMessages(chatKey),
		addAndSave: (current: ChatMessage[], newMsg: ChatMessage) =>
			addAndSaveMessage(chatKey, current, newMsg, config),
	};
}
