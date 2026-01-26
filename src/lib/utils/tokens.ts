/**
 * Token Counting and Context Management Utilities
 * Provides token estimation and chat history truncation for OpenAI API
 */

// Generic message type that works with both OpenAI and legacy Cohere formats
export interface GenericChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content?: string | null | unknown;
	toolCalls?: Array<{
		id: string;
		type: 'function';
		function: {
			name: string;
			arguments: string;
		};
	}>;
	toolCallId?: string;
	toolResults?: Array<{ content?: string }>;
	_timestamp?: string;
}

// Re-export for compatibility
export type ChatMessage = GenericChatMessage;

/**
 * Model context limits (in tokens)
 * GPT-4o-mini has 128K context, but we leave headroom for response
 */
export const MODEL_LIMITS = {
	'gpt-4o-mini': {
		contextWindow: 128000,
		maxOutputTokens: 16384,
		// Leave 20% headroom for response and safety margin
		effectiveInputLimit: 100000,
	},
	'gpt-4o': {
		contextWindow: 128000,
		maxOutputTokens: 16384,
		effectiveInputLimit: 100000,
	},
	'gpt-4-turbo': {
		contextWindow: 128000,
		maxOutputTokens: 4096,
		effectiveInputLimit: 100000,
	},
	// Legacy Cohere models for backward compatibility
	'command-a-03-2025': {
		contextWindow: 256000,
		maxOutputTokens: 4096,
		effectiveInputLimit: 200000,
	},
	default: {
		contextWindow: 128000,
		maxOutputTokens: 16384,
		effectiveInputLimit: 100000,
	},
} as const;

export type ModelName = keyof typeof MODEL_LIMITS;

/**
 * Estimate token count for a string
 * Uses a heuristic: ~4 characters per token on average for English text
 * This is a rough approximation - actual tokenization may vary
 */
export function estimateTokens(text: string): number {
	if (!text) return 0;

	// Count words (rough token estimate)
	const words = text.split(/\s+/).filter(Boolean).length;

	// Count special characters that often become separate tokens
	const specialChars = (text.match(/[^\w\s]/g) || []).length;

	// Estimate: words + special chars, with a minimum based on character count
	const wordBasedEstimate = words + specialChars;
	const charBasedEstimate = Math.ceil(text.length / 4);

	// Use the larger estimate for safety
	return Math.max(wordBasedEstimate, charBasedEstimate);
}

/**
 * Estimate token count for a chat message
 */
export function estimateMessageTokens(message: GenericChatMessage): number {
	let tokens = 0;

	// Role overhead (~2-4 tokens)
	tokens += 4;

	// Content
	if (typeof message.content === 'string') {
		tokens += estimateTokens(message.content);
	} else if (Array.isArray(message.content)) {
		for (const item of message.content) {
			if (typeof item === 'string') {
				tokens += estimateTokens(item);
			} else if (item && typeof item === 'object' && 'text' in item) {
				tokens += estimateTokens((item as { text: string }).text);
			}
		}
	}

	// Tool calls add overhead
	if ('toolCalls' in message && message.toolCalls) {
		tokens += 20; // Base overhead for tool call structure
		for (const toolCall of message.toolCalls as Array<{ function?: { name?: string; arguments?: string } }>) {
			if (toolCall.function?.name) {
				tokens += estimateTokens(toolCall.function.name);
			}
			if (toolCall.function?.arguments) {
				tokens += estimateTokens(toolCall.function.arguments);
			}
		}
	}

	// Tool results add overhead
	if ('toolResults' in message && message.toolResults) {
		tokens += 10; // Base overhead
		for (const result of message.toolResults as Array<{ content?: string }>) {
			if (result.content) {
				tokens += estimateTokens(result.content);
			}
		}
	}

	return tokens;
}

/**
 * Estimate total tokens for a chat history
 */
export function estimateChatHistoryTokens(messages: GenericChatMessage[]): number {
	return messages.reduce((total, msg) => total + estimateMessageTokens(msg), 0);
}

/**
 * Truncate chat history to fit within token limit
 * Preserves the most recent messages and system messages
 */
export function truncateChatHistory(
	messages: GenericChatMessage[],
	maxTokens: number,
	options: {
		preserveSystemMessages?: boolean;
		preserveRecentCount?: number;
		summarizeOld?: boolean;
	} = {}
): GenericChatMessage[] {
	const { preserveSystemMessages = true, preserveRecentCount = 4 } = options;

	// If already within limit, return as-is
	const currentTokens = estimateChatHistoryTokens(messages);
	if (currentTokens <= maxTokens) {
		return messages;
	}

	// Separate system messages and regular messages
	const systemMessages = preserveSystemMessages
		? messages.filter((m) => m.role === 'system')
		: [];
	const nonSystemMessages = messages.filter((m) => m.role !== 'system');

	// Calculate tokens used by system messages
	const systemTokens = estimateChatHistoryTokens(systemMessages);
	const availableTokens = maxTokens - systemTokens;

	if (availableTokens <= 0) {
		// Even system messages exceed limit, truncate them too
		return truncateMessages(messages, maxTokens);
	}

	// Preserve recent messages
	const recentMessages = nonSystemMessages.slice(-preserveRecentCount);
	const recentTokens = estimateChatHistoryTokens(recentMessages);

	if (recentTokens >= availableTokens) {
		// Even recent messages exceed limit
		const truncatedRecent = truncateMessages(recentMessages, availableTokens);
		return [...systemMessages, ...truncatedRecent];
	}

	// Add older messages until we hit the limit
	const olderMessages = nonSystemMessages.slice(0, -preserveRecentCount);
	const remainingTokens = availableTokens - recentTokens;

	const includedOlder: GenericChatMessage[] = [];
	let usedTokens = 0;

	// Add from oldest to newest (to maintain order)
	for (const msg of olderMessages) {
		const msgTokens = estimateMessageTokens(msg);
		if (usedTokens + msgTokens <= remainingTokens) {
			includedOlder.push(msg);
			usedTokens += msgTokens;
		} else {
			// Add truncation indicator
			includedOlder.push({
				role: 'assistant',
				content: '[Earlier conversation history truncated to fit context window]',
			});
			break;
		}
	}

	return [...systemMessages, ...includedOlder, ...recentMessages];
}

/**
 * Simple message truncation - removes oldest messages first
 */
function truncateMessages(messages: GenericChatMessage[], maxTokens: number): GenericChatMessage[] {
	const result: GenericChatMessage[] = [];
	let totalTokens = 0;

	// Process from newest to oldest
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		const msgTokens = estimateMessageTokens(msg);

		if (totalTokens + msgTokens <= maxTokens) {
			result.unshift(msg);
			totalTokens += msgTokens;
		} else {
			break;
		}
	}

	return result;
}

/**
 * Get the effective token limit for a model
 */
export function getModelTokenLimit(model: string): number {
	const modelKey = model as ModelName;
	return MODEL_LIMITS[modelKey]?.effectiveInputLimit ?? MODEL_LIMITS.default.effectiveInputLimit;
}

/**
 * Check if chat history is within safe limits
 */
export function isWithinTokenLimit(messages: GenericChatMessage[], model: string = 'gpt-4o-mini'): boolean {
	const limit = getModelTokenLimit(model);
	const tokens = estimateChatHistoryTokens(messages);
	return tokens <= limit;
}

/**
 * Get token usage info for a chat history
 */
export function getTokenUsage(
	messages: GenericChatMessage[],
	model: string = 'gpt-4o-mini'
): {
	used: number;
	limit: number;
	remaining: number;
	percentUsed: number;
	isWithinLimit: boolean;
} {
	const limit = getModelTokenLimit(model);
	const used = estimateChatHistoryTokens(messages);
	const remaining = Math.max(0, limit - used);

	return {
		used,
		limit,
		remaining,
		percentUsed: Math.round((used / limit) * 100),
		isWithinLimit: used <= limit,
	};
}

/**
 * Strip internal fields (like _timestamp) that shouldn't be sent to OpenAI API
 */
function stripInternalFields(message: GenericChatMessage): GenericChatMessage {
	const { _timestamp, ...cleanMessage } = message;
	return cleanMessage;
}

/**
 * Prepare chat history for API call - truncates if needed and strips internal fields
 */
export function prepareChatHistory(
	messages: GenericChatMessage[],
	model: string = 'gpt-4o-mini'
): GenericChatMessage[] {
	const limit = getModelTokenLimit(model);
	const truncated = truncateChatHistory(messages, limit);
	// Strip internal fields like _timestamp before sending to OpenAI
	return truncated.map(stripInternalFields);
}
