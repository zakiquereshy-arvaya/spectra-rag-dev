/**
 * Intent Detection
 * Pure functions for detecting user intent from messages.
 * Extracted from unified-mcp-server.ts for modularity and testability.
 */

import { getTodayEastern, formatDateEastern } from '$lib/utils/datetime';

// ==================== AVAILABILITY INTENT ====================

export function extractAvailabilityName(message: string): string | null {
	const text = message.trim();
	const patterns = [
		/(?:with|for)\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})/i,
		/(?:book|meet(?:ing)?\s+with)\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})/i,
		/([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})'s\s+availability/i,
		/(?:availability|available)\s+(?:for|of)\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})/i,
	];
	const stopWords = new Set(['me', 'my', 'i', 'we', 'us', 'our', 'someone', 'anyone', 'team']);
	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match?.[1]) {
			const name = match[1].trim().replace(/[.,!?]$/, '');
			if (name && !stopWords.has(name.toLowerCase())) {
				return name;
			}
		}
	}
	return null;
}

export function extractAvailabilityDate(message: string, parseDate: (d: string) => string): string | null {
	const text = message.toLowerCase();
	const datePatterns = [
		/\b\d{4}-\d{2}-\d{2}\b/,
		/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
		/\b(today|tomorrow|yesterday)\b/,
		/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
		// Handle "this coming tuesday", "this tuesday", "coming tuesday"
		/\b(?:this\s+(?:coming\s+)?|coming\s+)(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
		// Handle ordinal dates like "the 17th", "on the 20th", "on february 17"
		/\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/,
	];
	for (const pattern of datePatterns) {
		const match = text.match(pattern);
		if (match?.[0]) {
			return parseDate(match[0]);
		}
	}
	return null;
}

export function detectAvailabilityIntent(
	message: string,
	parseDate: (d: string) => string
): { name: string; date: string } | null {
	const lower = message.toLowerCase();
	const availabilityKeywords = /\b(availability|available|free|schedule|booking|book|meet(?:ing)?)\b/i;
	if (!availabilityKeywords.test(lower)) return null;

	const name = extractAvailabilityName(message);
	const date = extractAvailabilityDate(message, parseDate);

	if (!name || !date) return null;
	return { name, date };
}

// ==================== TIME ENTRY INTENT ====================

export function detectTimeEntryIntent(message: string): boolean {
	const lower = message.toLowerCase();
	const hasHours = /\b\d+(\.\d+)?\s*(hours?|hrs?)\b/.test(lower);
	const hasLogKeywords = /\b(log|record|submit|entry)\b/.test(lower);
	const hasWorkContext = /\b(customer|client|tasks?|description|worked|billable)\b/.test(lower);
	return hasHours || hasLogKeywords || hasWorkContext;
}

// ==================== SCOPE & MIXED INTENT ====================

export function determineToolScope(
	message: string,
	parseDate: (d: string) => string
): 'calendar' | 'billing' | 'all' {
	const hasTimeEntryIntentFlag = detectTimeEntryIntent(message);
	const hasAvailabilityIntentFlag = !!detectAvailabilityIntent(message, parseDate);

	if (hasTimeEntryIntentFlag) return 'billing';
	if (hasAvailabilityIntentFlag) return 'calendar';
	return 'all';
}

export function hasMixedIntent(
	message: string,
	parseDate: (d: string) => string
): boolean {
	return detectTimeEntryIntent(message) && !!detectAvailabilityIntent(message, parseDate);
}

// ==================== CONFIRMATION ====================

export function isConfirmation(message: string): boolean {
	const normalized = message.toLowerCase().replace(/[^\w\s]/g, '').trim();
	if (!normalized) return false;
	if (normalized.length > 40) return false;
	return /^(ok(?:ay)?|yes|yep|yeah|sure|please|go ahead|go do it|do it|go for it|sounds good|alright|proceed|confirm)\b/.test(
		normalized
	);
}

// ==================== HELPERS ====================

/**
 * Extract text content from ChatMessage content field (handles string, array, object)
 */
export function extractTextContent(content: any): string {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.map((c) => {
				if (typeof c === 'string') return c;
				if (c && typeof c === 'object' && 'text' in c && typeof c.text === 'string') return c.text;
				return '';
			})
			.join(' ');
	}
	return String(content || '');
}

/**
 * Format availability response as text for chat history
 */
export function formatAvailabilityResponse(result: {
	user_email: string;
	date: string;
	day_of_week: string;
	busy_times?: Array<{ subject?: string; start: string; end: string }>;
	total_events?: number;
	note?: string;
}): string {
	const busyTimes = result.busy_times || [];
	if (busyTimes.length === 0) {
		return `${result.user_email} is free all day on ${result.day_of_week} (${result.date}). ${result.note || ''}`.trim();
	}
	const lines = busyTimes.map((event) => {
		const subject = event.subject ? ` (${event.subject})` : '';
		return `- ${event.start} to ${event.end}${subject}`;
	});
	return [
		`${result.user_email} is busy on ${result.day_of_week} (${result.date}) during:`,
		...lines,
		result.note || '',
	]
		.filter(Boolean)
		.join('\n');
}
