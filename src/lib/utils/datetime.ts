/**
 * Date/Time Utilities
 * Centralized date and time parsing/formatting functions
 */

// Day name to number mapping
const DAY_MAP: Record<string, number> = {
	sunday: 0,
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6,
};

/**
 * Parse natural language date strings like "next monday", "tomorrow", "1/12/2026"
 * Returns date in YYYY-MM-DD format
 */
export function parseNaturalDate(dateString: string | undefined | null): string {
	if (!dateString || dateString.trim() === '') {
		const today = new Date();
		return today.toISOString().split('T')[0];
	}

	const lower = dateString.toLowerCase().trim();
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	// Handle relative dates
	if (lower === 'today') {
		return today.toISOString().split('T')[0];
	}

	if (lower === 'tomorrow') {
		const tomorrow = new Date(today);
		tomorrow.setDate(tomorrow.getDate() + 1);
		return tomorrow.toISOString().split('T')[0];
	}

	if (lower === 'yesterday') {
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);
		return yesterday.toISOString().split('T')[0];
	}

	// Handle "next [day]" patterns
	const nextDayMatch = lower.match(/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
	if (nextDayMatch) {
		const dayName = nextDayMatch[1];
		const targetDay = DAY_MAP[dayName];
		const nextDate = new Date(today);
		const daysUntil = (targetDay - today.getDay() + 7) % 7 || 7; // If today, get next week's
		nextDate.setDate(today.getDate() + daysUntil);
		return nextDate.toISOString().split('T')[0];
	}

	// Handle "this [day]" patterns
	const thisDayMatch = lower.match(/this\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
	if (thisDayMatch) {
		const dayName = thisDayMatch[1];
		const targetDay = DAY_MAP[dayName];
		const thisDate = new Date(today);
		const daysUntil = (targetDay - today.getDay() + 7) % 7;
		thisDate.setDate(today.getDate() + daysUntil);
		return thisDate.toISOString().split('T')[0];
	}

	// Try parsing as date string (MM/DD/YYYY, YYYY-MM-DD, etc.)
	let parsedDate: Date;
	if (lower.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
		// MM/DD/YYYY format
		const [month, day, year] = lower.split('/').map(Number);
		parsedDate = new Date(year, month - 1, day);
	} else if (lower.match(/^\d{4}-\d{2}-\d{2}$/)) {
		// YYYY-MM-DD format
		parsedDate = new Date(lower + 'T00:00:00');
	} else {
		// Try native Date parsing
		parsedDate = new Date(dateString);
	}

	if (isNaN(parsedDate.getTime())) {
		console.warn(`Could not parse date: ${dateString}, using today`);
		return today.toISOString().split('T')[0];
	}

	return parsedDate.toISOString().split('T')[0];
}

/**
 * Convert UTC datetime to local time string in Eastern timezone
 */
export function convertToEasternTime(utcDateTime: string): string {
	const date = new Date(utcDateTime);
	return date.toLocaleTimeString('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
		timeZone: 'America/New_York',
	});
}

/**
 * Format UTC datetime to local date and time string in Eastern timezone
 */
export function formatEasternDateTime(utcDateTime: string): string {
	const date = new Date(utcDateTime);
	const dateStr = date.toLocaleDateString('en-US', {
		weekday: 'short',
		month: 'numeric',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'America/New_York',
	});
	const timeStr = date.toLocaleTimeString('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
		timeZone: 'America/New_York',
	});
	return `${dateStr} ${timeStr}`;
}

/**
 * Parse a time string (e.g., "9:00 AM", "14:30", "930") and return hours and minutes
 */
export function parseTimeString(timeStr: string): { hours: number; minutes: number } | null {
	const trimmed = timeStr.trim();

	// Normalize numeric-only times like "930" or "1430"
	let normalized = trimmed;
	if (/^\d{3,4}$/.test(normalized) && !normalized.includes(':')) {
		if (normalized.length === 3) {
			normalized = `${normalized[0]}:${normalized.slice(1)}`;
		} else if (normalized.length === 4) {
			normalized = `${normalized.slice(0, 2)}:${normalized.slice(2)}`;
		}
	}

	const timeMatch = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
	if (!timeMatch) {
		return null;
	}

	let hours = parseInt(timeMatch[1], 10);
	const minutes = parseInt(timeMatch[2] || '0', 10);
	const period = timeMatch[3]?.toUpperCase();

	// Handle 12-hour format
	if (period === 'PM' && hours < 12) {
		hours += 12;
	} else if (period === 'AM' && hours === 12) {
		hours = 0;
	} else if (!period && hours < 8) {
		// Assume PM for times like "1:00" (likely 1 PM, not 1 AM)
		hours += 12;
	}

	return { hours, minutes };
}

/**
 * Parse a time string in Eastern timezone and return an ISO datetime string
 */
export function parseTimeInEastern(timeStr: string, dateStr: string): string | null {
	const trimmed = timeStr.trim();

	// If already ISO format, return as-is
	if (trimmed.includes('T') || trimmed.match(/^\d{4}-\d{2}-\d{2}/)) {
		return trimmed;
	}

	const parsed = parseTimeString(timeStr);
	if (!parsed) {
		return null;
	}

	// Create date in Eastern timezone
	const dateObj = new Date(`${dateStr}T${String(parsed.hours).padStart(2, '0')}:${String(parsed.minutes).padStart(2, '0')}:00`);

	// Adjust for EST/EDT (-05:00 or -04:00)
	// For simplicity, using fixed -05:00 (EST)
	const isoString = `${dateStr}T${String(parsed.hours).padStart(2, '0')}:${String(parsed.minutes).padStart(2, '0')}:00-05:00`;

	return new Date(isoString).toISOString();
}

/**
 * Get the day of week name for a date
 */
export function getDayOfWeek(dateStr: string): string {
	const date = new Date(dateStr + 'T00:00:00');
	return date.toLocaleDateString('en-US', {
		weekday: 'long',
		timeZone: 'America/New_York',
	});
}

/**
 * Check if a date is in the past
 */
export function isDateInPast(dateStr: string): boolean {
	const date = new Date(dateStr + 'T00:00:00');
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	return date < today;
}

/**
 * Check if a date is a weekend
 */
export function isWeekend(dateStr: string): boolean {
	const date = new Date(dateStr + 'T00:00:00');
	const day = date.getDay();
	return day === 0 || day === 6;
}

/**
 * Format a duration in minutes to human readable string
 */
export function formatDuration(minutes: number): string {
	if (minutes < 60) {
		return `${minutes} minutes`;
	}
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	if (mins === 0) {
		return hours === 1 ? '1 hour' : `${hours} hours`;
	}
	return `${hours}h ${mins}m`;
}
