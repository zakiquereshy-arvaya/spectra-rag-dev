// Chat Persistence Store - Saves conversations to localStorage with automatic pruning
import type { ChatMessage } from '$lib/api/chat';

export interface ChatPersistenceConfig {
	maxMessages: number; // Maximum messages to keep per chat
	maxAge: number; // Maximum age in milliseconds (e.g., 24 hours = 86400000)
}

const DEFAULT_CONFIG: ChatPersistenceConfig = {
	maxMessages: 50, // Keep last 50 messages
	maxAge: 24 * 60 * 60 * 1000, // 24 hours
};

// Keys for different chat sections
export const CHAT_KEYS = {
	appointments: 'chat-appointments-messages',
	billi: 'chat-billi-messages',
	spectraJob: 'chat-spectra-job-messages',
} as const;

export type ChatKey = keyof typeof CHAT_KEYS;

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
 */
export function saveMessages(
	chatKey: ChatKey,
	messages: ChatMessage[],
	config: ChatPersistenceConfig = DEFAULT_CONFIG
): void {
	if (typeof window === 'undefined') {
		return;
	}

	try {
		const now = Date.now();

		// Filter out messages older than maxAge
		const filteredMessages = messages.filter((msg) => {
			const messageTime = new Date(msg.timestamp).getTime();
			return now - messageTime < config.maxAge;
		});

		// Keep only the last maxMessages
		const prunedMessages = filteredMessages.slice(-config.maxMessages);

		localStorage.setItem(CHAT_KEYS[chatKey], JSON.stringify(prunedMessages));
	} catch (error) {
		console.error(`Error saving messages for ${chatKey}:`, error);
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
