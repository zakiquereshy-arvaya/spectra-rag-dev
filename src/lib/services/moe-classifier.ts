// MoE Classifier - Intent classification with confidence scoring
// Routes user messages to the appropriate expert based on intent

import OpenAI from 'openai';
import type { ChatMessage } from './openai-service';

export interface ClassificationResult {
	category: 'appointments' | 'billing' | 'general';
	confidence: number; // 0.0 to 1.0
	reasoning?: string;
}

export class MoEClassifier {
	private client: OpenAI;
	private model: string;

	constructor(apiKey: string, model: string = 'gpt-4o-mini') {
		this.client = new OpenAI({ apiKey });
		this.model = model;
	}

	/**
	 * Classify user message into a category with confidence score
	 * @param message - The user's message to classify
	 * @param chatHistory - Optional chat history for context
	 * @returns Classification result with category, confidence, and optional reasoning
	 */
	async classify(
		message: string,
		chatHistory?: ChatMessage[]
	): Promise<ClassificationResult> {
		const systemPrompt = `You are an intent classifier for Arvaya AI & Automations. Your job is to categorize user messages into one of three categories.

Categories:
- "appointments": Calendar, meetings, scheduling, availability checks, booking rooms, finding free time slots, Microsoft Calendar operations. IMPORTANT: Only classify as "appointments" if the user wants to SCHEDULE or BOOK a meeting. If "meeting" appears in a task description for time logging, it's "billing".
- "billing": Time entries, logging hours, work tracking, QuickBooks, invoicing, customers/clients for billing, recording tasks completed. This includes messages like "log X hours for customer, tasks: did Y before meeting" - the word "meeting" here is part of the task description, not a request to book a meeting.
- "general": Greetings, questions about capabilities, unclear intent, mixed requests, or anything that doesn't clearly fit appointments or billing

CRITICAL RULE: If a message contains time entry indicators (customer, hours, tasks, description, "log", "record", "submit") AND mentions "meeting", prioritize "billing" unless the message explicitly asks to schedule/book a meeting.
CRITICAL RULE: If a message clearly asks for BOTH calendar actions and time entry logging in the same request, classify as "general" and set reasoning to "mixed_intent".

Instructions:
1. Analyze the message carefully - look for PRIMARY intent
2. Consider context from chat history if provided
3. If message mentions "meeting" but also has time entry keywords (customer, hours, tasks, log, record), classify as "billing"
4. If both calendar intent and time entry intent are present, return category "general" with reasoning "mixed_intent"
4. Assign a confidence score (0.0 to 1.0) based on how certain you are
5. High confidence (0.8+): Clear, unambiguous intent
6. Medium confidence (0.5-0.8): Likely intent but some ambiguity
7. Low confidence (<0.5): Unclear or could be multiple categories

Return ONLY valid JSON in this format:
{
  "category": "appointments" | "billing" | "general",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

		const userPrompt = `Classify this message:
"${message}"

${chatHistory && chatHistory.length > 0 ? `Recent context: ${this.summarizeHistory(chatHistory)}` : ''}

Return ONLY the JSON classification.`;

		try {
			const response = await this.client.chat.completions.create({
				model: this.model,
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt },
				],
			});

			return this.parseClassification(response);
		} catch (error) {
			console.error('[MoEClassifier] Classification error:', error);
			// Return general with low confidence on error
			return {
				category: 'general',
				confidence: 0.3,
				reasoning: 'Classification failed, defaulting to general',
			};
		}
	}

	/**
	 * Summarize chat history for context
	 * Where is this getting the last three history messages form, shouldnt it be requerying the database for the last three messages?, the issue I take is the local storage is going to be too large and slow down the app. Or Crash it
	 */
	private summarizeHistory(chatHistory: ChatMessage[]): string {
		// Take last 3 messages for context
		const recent = chatHistory.slice(-3);
		return recent
			.map((msg) => {
				const content = typeof msg.content === 'string' ? msg.content : '';
				return `${msg.role}: ${content.substring(0, 100)}`;
			})
			.join(' | ');
	}

	/**
	 * Parse OpenAI response into ClassificationResult
	 */
	private parseClassification(response: OpenAI.Chat.Completions.ChatCompletion): ClassificationResult {
		let text = '';
		const choice = response.choices[0];
		const content = choice?.message?.content;

		if (typeof content === 'string') {
			text = content.trim();
		}

		if (!text) {
			return {
				category: 'general',
				confidence: 0.3,
				reasoning: 'Empty response from classifier',
			};
		}

		// Handle markdown code blocks
		if (text.startsWith('```')) {
			const parts = text.split('```');
			if (parts.length > 1) {
				text = parts[1];
				if (text.startsWith('json')) {
					text = text.slice(4);
				}
				text = text.trim();
			}
		}

		try {
			const parsed = JSON.parse(text);

			// Validate category
			const validCategories = ['appointments', 'billing', 'general'];
			const category = validCategories.includes(parsed.category)
				? (parsed.category as 'appointments' | 'billing' | 'general')
				: 'general';

			// Validate confidence (ensure it's between 0 and 1)
			let confidence = parseFloat(parsed.confidence);
			if (isNaN(confidence) || confidence < 0) confidence = 0.3;
			if (confidence > 1) confidence = 1;

			return {
				category,
				confidence,
				reasoning: parsed.reasoning || undefined,
			};
		} catch {
			console.warn('[MoEClassifier] Failed to parse classification:', text);
			return {
				category: 'general',
				confidence: 0.3,
				reasoning: 'Failed to parse classifier response',
			};
		}
	}

	/**
	 * Quick classification for simple pattern matching
	 * Use this as a first-pass before LLM classification for obvious cases
	 * IMPORTANT: Check billing patterns FIRST when time entry indicators are present,
	 * to avoid false positives from "meeting" appearing in task descriptions
	 */
	quickClassify(message: string): ClassificationResult | null {
		const lower = message.toLowerCase();

		// High-confidence billing patterns - CHECK THESE FIRST
		// This prevents "meeting" in task descriptions from triggering appointment classification
		const billingPatterns = [
			/\b(log|record|submit)\s+.*\s*(hours?|time)\b/,
			/\b\d+(\.\d+)?\s*(hours?|hrs?)\s+(for|on)\b/,
			/\btime\s+entry\b/,
			/\btime\s+log\s+ some time \+ time\b/,
			/\bbillable\b/,
			/\bquickbooks\b/i,
			// Patterns that indicate time logging context
			/\b(customer|client|hours|tasks?|description|worked\s+on)\b.*\b(log|record|submit|entry)\b/i,
			/\b(log|record|submit|entry).*\b(customer|client|hours|tasks?|description)\b/i,
		];

		// Check billing patterns FIRST when there are clear time entry indicators
		// This handles cases like "log time for arvaya, tasks: testing before meeting"
		const hasTimeEntryIndicators = 
			/\b(log|record|submit|entry)\b/i.test(lower) ||
			/\b\d+(\.\d+)?\s*(hours?|hrs?)\b/.test(lower) ||
			/\b(customer|client|tasks?|description|worked)\b/i.test(lower);

		const schedulingIndicators = /\b(availability|available|free|schedule|booking|book|calendar)\b/;
		const hasSchedulingIndicators = schedulingIndicators.test(lower);

		if (hasTimeEntryIndicators && hasSchedulingIndicators) {
			return {
				category: 'general',
				confidence: 0.9,
				reasoning: 'mixed_intent',
			};
		}

		if (hasTimeEntryIndicators) {
			for (const pattern of billingPatterns) {
				if (pattern.test(lower)) {
					return {
						category: 'billing',
						confidence: 0.95,
						reasoning: 'Pattern match: billing-related keywords with time entry context',
					};
				}
			}
		}

		// High-confidence appointment patterns
		// Only match "meeting" when it's clearly about scheduling, not in task descriptions
		const appointmentPatterns = [
			/\b(book|schedule)\s+(a\s+)?(meeting|appointment)\b/,
			/\b(book|schedule)\s+.*\s+(meeting|appointment)\b/,
			/\bcheck\s+(my\s+)?availability\b/,
			/\bwhat('s|\s+is)\s+.*\s+schedule\b/,
			/\b(calendar|appointment|available|free\s+(time|slot))\b/,
			// Only match "meeting" if it's clearly about scheduling, not in task descriptions
			/\b(create|set\s+up|arrange)\s+(a\s+)?meeting\b/,
		];

		for (const pattern of appointmentPatterns) {
			if (pattern.test(lower)) {
				// Double-check: if this looks like a time entry request, don't classify as appointment
				if (hasTimeEntryIndicators) {
					continue; // Skip appointment classification if time entry indicators present
				}
				return {
					category: 'appointments',
					confidence: 0.9,
					reasoning: 'Pattern match: appointment-related keywords',
				};
			}
		}

		// Check billing patterns again if no appointment match (for cases without strong time entry indicators)
		if (!hasTimeEntryIndicators) {
			for (const pattern of billingPatterns) {
				if (pattern.test(lower)) {
					return {
						category: 'billing',
						confidence: 0.9,
						reasoning: 'Pattern match: billing-related keywords',
					};
				}
			}
		}

		// Check for greetings - general category
		const greetingPatterns = [/^(hi|hello|hey|good\s+(morning|afternoon|evening))/i, /^what\s+can\s+you\s+(do|help)/i];

		for (const pattern of greetingPatterns) {
			if (pattern.test(lower)) {
				return {
					category: 'general',
					confidence: 0.95,
					reasoning: 'Pattern match: greeting or capability question',
				};
			}
		}

		// No quick match - need LLM classification
		return null;
	}
}
