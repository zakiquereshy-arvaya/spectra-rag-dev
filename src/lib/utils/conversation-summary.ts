/**
 * Conversation Summarization
 * Compresses older messages into a structured summary to maintain context
 * while reducing token usage in long conversations.
 */

import OpenAI from 'openai';
import type { GenericChatMessage } from '$lib/utils/tokens';

export const SUMMARY_MARKER = '[CONVERSATION_SUMMARY]';

const SUMMARY_SYSTEM_PROMPT = `You are a conversation summarizer for a business assistant that handles time tracking and calendar management.
Produce a concise structured summary of the conversation so far. Focus on:

1. KEY ENTITIES: Employee names + QBO IDs, customer names + QBO IDs discovered via lookups
2. DECISIONS MADE: What actions were taken (time entries submitted, meetings booked, etc.)
3. PENDING ACTIONS: Any unresolved requests or follow-ups
4. TOOL RESULTS: Important lookup results (employee/customer IDs, availability data)

Format as a compact bulleted list. Omit pleasantries and filler. Keep under 300 words.
Prefix your response with: ${SUMMARY_MARKER}`;

/**
 * Check if a message is a conversation summary
 */
export function isSummaryMessage(msg: GenericChatMessage): boolean {
	if (msg.role !== 'assistant') return false;
	const content = typeof msg.content === 'string' ? msg.content : '';
	return content.startsWith(SUMMARY_MARKER);
}

/**
 * Summarize older messages, keeping the most recent ones intact.
 * Returns a compressed history: [summary_message, ...recent_messages]
 *
 * Only triggers when message count exceeds `threshold`.
 * Keeps the last `recentToKeep` messages verbatim.
 */
export async function summarizeOlderMessages(
	messages: GenericChatMessage[],
	openaiApiKey: string,
	options: {
		recentToKeep?: number;
		threshold?: number;
	} = {}
): Promise<GenericChatMessage[]> {
	const { recentToKeep = 6, threshold = 20 } = options;

	// Don't summarize if below threshold
	if (messages.length <= threshold) {
		return messages;
	}

	// If there's already a summary, check if we need to re-summarize
	const existingSummaryIdx = messages.findIndex(isSummaryMessage);

	// Find a safe split point that doesn't break tool-call groups.
	// Start from -recentToKeep and expand backward if needed to include
	// a complete tool-call group (assistant+toolCalls followed by tool messages).
	let splitIndex = messages.length - recentToKeep;
	if (splitIndex < 0) splitIndex = 0;

	// If the split point lands on a 'tool' message, walk backward to include
	// its preceding assistant+toolCalls message
	while (splitIndex > 0 && messages[splitIndex]?.role === 'tool') {
		splitIndex--;
	}

	const olderMessages = messages.slice(0, splitIndex);
	const recentMessages = messages.slice(splitIndex);

	// Build context for summarization — include existing summary if present
	const contextForSummary = olderMessages
		.map((msg) => {
			const role = msg.role;
			let content = '';
			if (typeof msg.content === 'string') {
				content = msg.content;
			} else if (msg.content) {
				content = JSON.stringify(msg.content);
			}
			// Include tool call info
			if (msg.toolCalls) {
				const calls = msg.toolCalls.map(tc => `[Tool: ${tc.function.name}(${tc.function.arguments})]`).join(' ');
				content = `${content} ${calls}`.trim();
			}
			return `${role}: ${content}`;
		})
		.filter(line => line.length > 10) // Skip empty/trivial messages
		.join('\n');

	if (!contextForSummary.trim()) {
		return messages;
	}

	try {
		const client = new OpenAI({ apiKey: openaiApiKey });
		const response = await client.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [
				{ role: 'system', content: SUMMARY_SYSTEM_PROMPT },
				{ role: 'user', content: `Summarize this conversation:\n\n${contextForSummary}` },
			],
			max_tokens: 500,
			temperature: 0.2,
		});

		const summaryText = response.choices[0]?.message?.content || '';
		if (!summaryText) {
			// Summarization failed, return original
			return messages;
		}

		const summaryMessage: GenericChatMessage = {
			role: 'assistant',
			content: summaryText.startsWith(SUMMARY_MARKER)
				? summaryText
				: `${SUMMARY_MARKER}\n${summaryText}`,
		};

		return [summaryMessage, ...recentMessages];
	} catch (error) {
		console.error('[ConversationSummary] Failed to summarize:', error);
		// On failure, return original messages
		return messages;
	}
}
