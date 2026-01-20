// MoE Classifier - Intent classification with confidence scoring
// Routes user messages to the appropriate expert based on intent

import { CohereClientV2 } from 'cohere-ai';
import type { ChatMessageV2 } from 'cohere-ai/api';

export interface ClassificationResult {
	category: 'appointments' | 'billing' | 'general';
	confidence: number; // 0.0 to 1.0
	reasoning?: string;
}

export class MoEClassifier {
	private client: CohereClientV2;
	private model: string;

	constructor(apiKey: string, model: string = 'command-a-03-2025') {
		this.client = new CohereClientV2({ token: apiKey });
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
		chatHistory?: ChatMessageV2[]
	): Promise<ClassificationResult> {
		const systemPrompt = `You are an intent classifier for Arvaya AI & Automations. Your job is to categorize user messages into one of three categories.

Categories:
- "appointments": Calendar, meetings, scheduling, availability checks, booking rooms, finding free time slots, Microsoft Calendar operations
- "billing": Time entries, logging hours, work tracking, QuickBooks, invoicing, customers/clients for billing, recording tasks completed
- "general": Greetings, questions about capabilities, unclear intent, mixed requests, or anything that doesn't clearly fit appointments or billing

Instructions:
1. Analyze the message carefully
2. Consider context from chat history if provided
3. Assign a confidence score (0.0 to 1.0) based on how certain you are
4. High confidence (0.8+): Clear, unambiguous intent
5. Medium confidence (0.5-0.8): Likely intent but some ambiguity
6. Low confidence (<0.5): Unclear or could be multiple categories

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
			const response = await this.client.chat({
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
	private summarizeHistory(chatHistory: ChatMessageV2[]): string {
		// Take last 3 messages for context
		const recent = chatHistory.slice(-3);
		return recent
			.map((msg) => {
				const content =
					typeof msg.content === 'string'
						? msg.content
						: Array.isArray(msg.content)
							? msg.content
									.filter((item: any) => item.type === 'text')
									.map((item: any) => item.text)
									.join('')
							: '';
				return `${msg.role}: ${content.substring(0, 100)}`;
			})
			.join(' | ');
	}

	/**
	 * Parse Cohere response into ClassificationResult
	 */
	private parseClassification(response: unknown): ClassificationResult {
		let text = '';
		const message = (response as { message?: { content?: unknown } })?.message;
		const content = message?.content;

		if (typeof content === 'string') {
			text = content.trim();
		} else if (Array.isArray(content)) {
			text = content
				.filter((item: unknown) => (item as { type?: string })?.type === 'text')
				.map((item: unknown) => (item as { text?: string })?.text || '')
				.join('')
				.trim();
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
	 */
	quickClassify(message: string): ClassificationResult | null {
		const lower = message.toLowerCase();

		// High-confidence appointment patterns
		const appointmentPatterns = [
			/\b(book|schedule|meeting|calendar|appointment|available|free\s+(time|slot))\b/,
			/\bcheck\s+(my\s+)?availability\b/,
			/\bwhat('s|\s+is)\s+.*\s+schedule\b/,
		];

		// High-confidence billing patterns
		const billingPatterns = [
			/\b(log|record|submit)\s+.*\s*(hours?|time)\b/,
			/\b\d+(\.\d+)?\s*(hours?|hrs?)\s+(for|on)\b/,
			/\btime\s+entry\b/,
			/\bbillable\b/,
			/\bquickbooks\b/i,
		];

		for (const pattern of appointmentPatterns) {
			if (pattern.test(lower)) {
				return {
					category: 'appointments',
					confidence: 0.9,
					reasoning: 'Pattern match: appointment-related keywords',
				};
			}
		}

		for (const pattern of billingPatterns) {
			if (pattern.test(lower)) {
				return {
					category: 'billing',
					confidence: 0.9,
					reasoning: 'Pattern match: billing-related keywords',
				};
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
