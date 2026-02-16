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
 * Check if a message is a conversation summary (from summarization system)
 */
function isSummaryMessage(msg: GenericChatMessage): boolean {
	if (msg.role !== 'assistant') return false;
	const content = typeof msg.content === 'string' ? msg.content : '';
	return content.startsWith('[CONVERSATION_SUMMARY]');
}

/**
 * Group messages into "tool-call groups" for safe truncation.
 * A tool-call group is: [assistant+toolCalls, tool, tool, ...] 
 * All other messages are standalone groups of size 1.
 * This ensures we never split an assistant+toolCalls from its tool results.
 */
function groupMessages(messages: GenericChatMessage[]): GenericChatMessage[][] {
	const groups: GenericChatMessage[][] = [];
	let i = 0;

	while (i < messages.length) {
		const msg = messages[i];

		// If this is an assistant message with toolCalls, group it with following tool messages
		if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
			const group: GenericChatMessage[] = [msg];
			i++;
			// Collect all immediately following tool messages
			while (i < messages.length && messages[i].role === 'tool') {
				group.push(messages[i]);
				i++;
			}
			groups.push(group);
		} else {
			groups.push([msg]);
			i++;
		}
	}

	return groups;
}

/**
 * Truncate chat history to fit within token limit.
 * Preserves system messages, conversation summaries, and the most recent messages.
 * Tool-call groups (assistant+toolCalls followed by tool messages) are kept together.
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

	// Separate system messages, summary messages, and regular messages
	const systemMessages = preserveSystemMessages
		? messages.filter((m) => m.role === 'system')
		: [];
	const summaryMessages = messages.filter(isSummaryMessage);
	const nonSystemMessages = messages.filter((m) => m.role !== 'system' && !isSummaryMessage(m));

	// Calculate tokens used by preserved messages (system + summaries)
	const preservedTokens = estimateChatHistoryTokens(systemMessages) + estimateChatHistoryTokens(summaryMessages);
	const availableTokens = maxTokens - preservedTokens;

	if (availableTokens <= 0) {
		// Even preserved messages exceed limit, truncate everything
		return truncateMessageGroups(nonSystemMessages, maxTokens);
	}

	// Group messages to keep tool-call groups intact
	const groups = groupMessages(nonSystemMessages);

	// Determine how many groups to include from the end to satisfy preserveRecentCount
	// Count individual messages from the end until we have at least preserveRecentCount
	let recentGroupCount = 0;
	let recentMessageCount = 0;
	for (let i = groups.length - 1; i >= 0; i--) {
		recentGroupCount++;
		recentMessageCount += groups[i].length;
		if (recentMessageCount >= preserveRecentCount) break;
	}

	const recentGroups = groups.slice(-recentGroupCount);
	const recentMessages = recentGroups.flat();
	const recentTokens = estimateChatHistoryTokens(recentMessages);

	if (recentTokens >= availableTokens) {
		// Even recent messages exceed limit
		const truncatedRecent = truncateMessageGroups(recentMessages, availableTokens);
		return [...systemMessages, ...summaryMessages, ...truncatedRecent];
	}

	// Add older message groups until we hit the limit
	const olderGroups = groups.slice(0, -recentGroupCount);
	const remainingTokens = availableTokens - recentTokens;

	const includedOlder: GenericChatMessage[] = [];
	let usedTokens = 0;

	// Add from oldest to newest (to maintain order), keeping groups intact
	for (const group of olderGroups) {
		const groupTokens = estimateChatHistoryTokens(group);
		if (usedTokens + groupTokens <= remainingTokens) {
			includedOlder.push(...group);
			usedTokens += groupTokens;
		} else {
			// Add truncation indicator
			includedOlder.push({
				role: 'assistant',
				content: '[Earlier conversation history truncated to fit context window]',
			});
			break;
		}
	}

	return [...systemMessages, ...summaryMessages, ...includedOlder, ...recentMessages];
}

/**
 * Simple message truncation - removes oldest message groups first.
 * Keeps tool-call groups intact to avoid orphaned tool messages.
 */
function truncateMessageGroups(messages: GenericChatMessage[], maxTokens: number): GenericChatMessage[] {
	const groups = groupMessages(messages);
	const result: GenericChatMessage[] = [];
	let totalTokens = 0;

	// Process from newest to oldest (keep most recent groups)
	for (let i = groups.length - 1; i >= 0; i--) {
		const group = groups[i];
		const groupTokens = estimateChatHistoryTokens(group);

		if (totalTokens + groupTokens <= maxTokens) {
			result.unshift(...group);
			totalTokens += groupTokens;
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
 * Sanitize tool messages to ensure valid OpenAI message ordering.
 * 
 * OpenAI requires that every message with role 'tool' must immediately follow
 * (or be part of a group following) an assistant message that contains 'tool_calls'.
 * The tool message's toolCallId must also match one of the tool_calls in that assistant message.
 * 
 * This function:
 * 1. Removes orphaned 'tool' messages that don't have a preceding assistant+toolCalls
 * 2. Strips toolCalls from assistant messages whose tool results were removed
 * 3. Ensures the message array is always valid for the OpenAI API
 */
export function sanitizeToolMessages(messages: GenericChatMessage[]): GenericChatMessage[] {
	if (!messages || messages.length === 0) return messages;

	const result: GenericChatMessage[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];

		if (msg.role === 'tool') {
			// Check if there's a preceding assistant message with matching tool_calls
			let hasMatchingAssistant = false;
			for (let j = result.length - 1; j >= 0; j--) {
				const prev = result[j];
				if (prev.role === 'tool') {
					// Continue looking back past other tool messages in the same group
					continue;
				}
				if (prev.role === 'assistant' && prev.toolCalls && prev.toolCalls.length > 0) {
					// Check if this tool message's ID matches one of the tool_calls
					if (!msg.toolCallId) {
						break; // No toolCallId, can't match
					}
					const matchingCall = prev.toolCalls.find(tc => tc.id === msg.toolCallId);
					if (matchingCall) {
						hasMatchingAssistant = true;
					}
				}
				break; // Stop at the first non-tool message
			}

			if (!hasMatchingAssistant) {
				console.warn(
					`[sanitizeToolMessages] Removing orphaned tool message (toolCallId: ${msg.toolCallId || 'none'}) - no matching assistant with tool_calls`
				);
				continue; // Skip this orphaned tool message
			}
		}

		result.push(msg);
	}

	// Second pass: remove assistant messages with toolCalls where ALL tool results are missing
	const finalResult: GenericChatMessage[] = [];
	for (let i = 0; i < result.length; i++) {
		const msg = result[i];

		if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
			// Check if any of the tool results follow
			const toolCallIds = new Set(msg.toolCalls.map(tc => tc.id));
			let hasAnyToolResult = false;
			for (let j = i + 1; j < result.length; j++) {
				if (result[j].role === 'tool' && result[j].toolCallId && toolCallIds.has(result[j].toolCallId!)) {
					hasAnyToolResult = true;
					break;
				}
				if (result[j].role !== 'tool') break; // Stop at next non-tool message
			}

			if (!hasAnyToolResult) {
				// Strip toolCalls from the assistant message to avoid dangling references
				// Keep the message if it has content, otherwise replace with a placeholder
				const cleanMsg: GenericChatMessage = { ...msg };
				delete cleanMsg.toolCalls;
				if (!cleanMsg.content) {
					cleanMsg.content = 'Processing request...';
				}
				console.warn(
					`[sanitizeToolMessages] Stripping toolCalls from assistant message - no matching tool results found`
				);
				finalResult.push(cleanMsg);
				continue;
			}
		}

		finalResult.push(msg);
	}

	return finalResult;
}

/**
 * Prepare chat history for API call - truncates if needed, sanitizes tool messages,
 * and strips internal fields
 */
export function prepareChatHistory(
	messages: GenericChatMessage[],
	model: string = 'gpt-4o-mini'
): GenericChatMessage[] {
	const limit = getModelTokenLimit(model);
	const truncated = truncateChatHistory(messages, limit);
	// Sanitize tool messages to ensure proper ordering for OpenAI API
	const sanitized = sanitizeToolMessages(truncated);
	// Strip internal fields like _timestamp before sending to OpenAI
	return sanitized.map(stripInternalFields);
}
