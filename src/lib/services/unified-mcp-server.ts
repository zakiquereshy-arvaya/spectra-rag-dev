
import { OpenAIService } from './openai-service';
import type { GenericChatMessage } from '$lib/utils/tokens';
import { MicrosoftGraphService } from './microsoft-graph';
import { MicrosoftGraphAuth } from './microsoft-graph-auth';
import { CalendarAIHelper } from './ai-calendar-helpers';
import {
	getEmployeeByName,
	getCustomerByName,
	getAllEmployees,
	getAllCustomers,
	type Employee,
	type Customer,
} from './azero-db';
import { getChatHistoryAsync, setChatHistoryAsync } from './chat-history-store';
import { prepareChatHistory } from '$lib/utils/tokens';

type StoredChatMessage = GenericChatMessage;

export interface UnifiedMCPRequest {
	message: string;
	sessionId: string;
}

export class UnifiedMCPServer {
	private openaiService: OpenAIService;
	private graphService: MicrosoftGraphService;
	private aiHelper: CalendarAIHelper | null;
	private sessionId: string;
	private chatHistory: StoredChatMessage[] = [];
	private loggedInUser: { name: string; email: string } | null = null;
	private lastTimestamp: number = 0;
	private historyLoaded: boolean = false;
	private webhookUrl: string;
	private lastAvailabilityDate: string | null = null;

	// Caches
	private cachedUsers: Array<{ name: string; email: string }> | null = null;
	private cachedEmployees: Employee[] | null = null;
	private cachedCustomers: Customer[] | null = null;

	constructor(
		openaiApiKey: string,
		sessionId: string,
		authService?: MicrosoftGraphAuth,
		accessToken?: string,
		loggedInUser?: { name: string; email: string },
		webhookUrl?: string
	) {
		this.openaiService = new OpenAIService(openaiApiKey);
		this.graphService = new MicrosoftGraphService(accessToken, authService);
		try {
			this.aiHelper = new CalendarAIHelper(openaiApiKey);
		} catch {
			this.aiHelper = null;
		}
		this.sessionId = sessionId;
		this.loggedInUser = loggedInUser || null;
		this.webhookUrl = webhookUrl || '';
	}

	/**
	 * Load chat history from Supabase
	 */
	async loadHistory(): Promise<void> {
		if (!this.historyLoaded) {
			this.chatHistory = await getChatHistoryAsync(this.sessionId);
			this.historyLoaded = true;
		}
	}

	/**
	 * Save chat history to Supabase
	 */
	async saveHistory(): Promise<void> {
		await setChatHistoryAsync(this.sessionId, this.chatHistory);
	}

	/**
	 * Add message(s) to chat history with timestamp
	 */
	private pushToHistory(...messages: GenericChatMessage[]): void {
		for (const msg of messages) {
			const now = Date.now();
			const timestamp = now > this.lastTimestamp ? now : this.lastTimestamp + 1;
			this.lastTimestamp = timestamp;

			this.chatHistory.push({
				...msg,
				_timestamp: new Date(timestamp).toISOString(),
			});
		}
	}

	// ==================== CACHES ====================

	private async getCachedUsers(): Promise<Array<{ name: string; email: string }>> {
		if (this.cachedUsers === null) {
			const users = await this.graphService.listUsers();
			this.cachedUsers = users.value.map((user) => ({
				name: user.displayName,
				email: user.mail || user.userPrincipalName,
			}));
		}
		return this.cachedUsers;
	}

	private async getCachedEmployees(): Promise<Employee[]> {
		if (this.cachedEmployees === null) {
			this.cachedEmployees = await getAllEmployees();
		}
		return this.cachedEmployees;
	}

	private async getCachedCustomers(): Promise<Customer[]> {
		if (this.cachedCustomers === null) {
			this.cachedCustomers = await getAllCustomers();
		}
		return this.cachedCustomers;
	}

	// ==================== DATE/TIME HELPERS ====================

	private parseDate(dateString: string | undefined | null): string {
		if (!dateString || dateString.trim() === '') {
			const today = new Date();
			return today.toISOString().split('T')[0];
		}

		const lower = dateString.toLowerCase().trim();
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		if (lower === 'today') return today.toISOString().split('T')[0];
		if (lower === 'tomorrow') {
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);
			return tomorrow.toISOString().split('T')[0];
		}

		const nextDayMatch = lower.match(/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
		if (nextDayMatch) {
			const dayMap: Record<string, number> = {
				sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
			};
			const targetDay = dayMap[nextDayMatch[1]];
			const daysUntil = (targetDay - today.getDay() + 7) % 7 || 7;
			const nextDate = new Date(today);
			nextDate.setDate(today.getDate() + daysUntil);
			return nextDate.toISOString().split('T')[0];
		}

		// Try parsing as date string
		if (lower.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
			const [month, day, year] = lower.split('/').map(Number);
			return new Date(year, month - 1, day).toISOString().split('T')[0];
		}
		if (lower.match(/^\d{1,2}\/\d{1,2}$/)) {
			const [month, day] = lower.split('/').map(Number);
			const year = today.getFullYear();
			return new Date(year, month - 1, day).toISOString().split('T')[0];
		}
		if (lower.match(/^\d{4}-\d{2}-\d{2}$/)) {
			return lower;
		}

		const parsedDate = new Date(dateString);
		if (!isNaN(parsedDate.getTime())) {
			return parsedDate.toISOString().split('T')[0];
		}

		return today.toISOString().split('T')[0];
	}

	private getEasternOffset(dateStr: string): string {
		const probe = new Date(`${dateStr}T12:00:00Z`);
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone: 'America/New_York',
			timeZoneName: 'shortOffset',
		}).formatToParts(probe);
		const tz = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT-05:00';
		const match = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
		if (!match) return '-05:00';
		const sign = match[1];
		const hours = match[2].padStart(2, '0');
		const minutes = (match[3] ?? '00').padStart(2, '0');
		return `${sign}${hours}:${minutes}`;
	}

	private convertToLocalTime(utcDateTime: string): string {
		const dateStr = utcDateTime.endsWith('Z') ? utcDateTime : utcDateTime + 'Z';
		const date = new Date(dateStr);
		return date.toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true,
			timeZone: 'America/New_York',
		});
	}

	private formatLocalDateTime(utcDateTime: string): string {
		const dateTimeStr = utcDateTime.endsWith('Z') ? utcDateTime : utcDateTime + 'Z';
		const date = new Date(dateTimeStr);
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

	// ==================== TIME ENTRY DETECTION ====================

	private extractAvailabilityName(message: string): string | null {
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

	private extractAvailabilityDate(message: string): string | null {
		const text = message.toLowerCase();
		const datePatterns = [
			/\b\d{4}-\d{2}-\d{2}\b/,
			/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
			/\b(today|tomorrow|yesterday)\b/,
			/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
		];
		for (const pattern of datePatterns) {
			const match = text.match(pattern);
			if (match?.[0]) {
				return this.parseDate(match[0]);
			}
		}
		return null;
	}

	private detectAvailabilityIntent(message: string): { name: string; date: string } | null {
		const lower = message.toLowerCase();
		const availabilityKeywords = /\b(availability|available|free|schedule|booking|book|meet(?:ing)?)\b/i;
		if (!availabilityKeywords.test(lower)) return null;

		const name = this.extractAvailabilityName(message);
		const date = this.extractAvailabilityDate(message);

		if (!name || !date) return null;
		return { name, date };
	}

	private isConfirmation(message: string): boolean {
		const normalized = message.toLowerCase().replace(/[^\w\s]/g, '').trim();
		if (!normalized) return false;
		if (normalized.length > 40) return false;
		return /^(ok(?:ay)?|yes|yep|yeah|sure|please|go ahead|go do it|do it|go for it|sounds good|alright|proceed|confirm)\b/.test(
			normalized
		);
	}

	private getRecentAvailabilityIntent(): { name: string; date: string } | null {
		for (let i = this.chatHistory.length - 1; i >= 0; i--) {
			const msg = this.chatHistory[i];
			if (msg.role !== 'user') continue;
			const text = this.extractTextContent(msg.content);
			const intent = this.detectAvailabilityIntent(text);
			if (intent) return intent;
		}
		return null;
	}

	private resolveAvailabilityIntent(message: string): { name: string; date: string } | null {
		const direct = this.detectAvailabilityIntent(message);
		if (direct) return direct;
		if (this.isConfirmation(message)) {
			return this.getRecentAvailabilityIntent();
		}
		return null;
	}

	private detectTimeEntryIntent(message: string): boolean {
		const lower = message.toLowerCase();
		const hasHours = /\b\d+(\.\d+)?\s*(hours?|hrs?)\b/.test(lower);
		const hasLogKeywords = /\b(log|record|submit|entry)\b/.test(lower);
		const hasWorkContext = /\b(customer|client|tasks?|description|worked|billable)\b/.test(lower);
		return hasHours || hasLogKeywords || hasWorkContext;
	}

	private determineToolScope(message: string): 'calendar' | 'billing' | 'all' {
		const hasTimeEntryIntent = this.detectTimeEntryIntent(message);
		const hasAvailabilityIntent = !!this.detectAvailabilityIntent(message);

		if (hasTimeEntryIntent) {
			return 'billing';
		}
		if (hasAvailabilityIntent) {
			return 'calendar';
		}
		return 'all';
	}

	private hasMixedIntent(message: string): boolean {
		const hasTimeEntryIntent = this.detectTimeEntryIntent(message);
		const hasAvailabilityIntent = !!this.detectAvailabilityIntent(message);
		return hasTimeEntryIntent && hasAvailabilityIntent;
	}

	private formatAvailabilityResponse(result: {
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

	/**
	 * Extract text content from ChatMessageV2 content field
	 */
	private extractTextContent(content: any): string {
		if (typeof content === 'string') {
			return content;
		}
		if (Array.isArray(content)) {
			return content.map(c => {
				if (typeof c === 'string') return c;
				if (c && typeof c === 'object') {
					if ('text' in c && typeof (c as any).text === 'string') return (c as any).text;
					return '';
				}
				return '';
			}).join(' ');
		}
		return String(content || '');
	}

	/**
	 * Check if response text claims to have logged time
	 */
	private claimsToHaveLoggedTime(text: string): boolean {
		const lowerText = text.toLowerCase();
		const claimPatterns = [
			/logged.*hour/i,
			/logged.*time/i,
			/time.*logged/i,
			/submitted.*time/i,
			/time.*submitted/i,
			/time entry.*logged/i,
			/logged.*time entry/i,
			/entry.*submitted/i,
			/submitted.*entry/i,
		];
		return claimPatterns.some(pattern => pattern.test(lowerText));
	}

	/**
	 * Extract time entry information from conversation context
	 */
	private extractTimeEntryInfo(): {
		employee_name?: string;
		employee_qbo_id?: string;
		customer_name?: string;
		customer_qbo_id?: string;
		tasks_completed?: string;
		hours?: number;
		entry_date?: string;
	} {
		const info: any = {};
		
		// Look through recent chat history for tool results
		for (let i = this.chatHistory.length - 1; i >= 0; i--) {
			const msg = this.chatHistory[i];
			
			// Check tool results for lookup results
			if (msg.role === 'tool' && msg.content) {
				try {
					const contentStr = this.extractTextContent(msg.content);
					const result = JSON.parse(contentStr);
					
					// Found employee lookup result
					if (result.found === true && result.employee) {
						info.employee_name = result.employee.name;
						info.employee_qbo_id = result.employee.qbo_id;
					}
					
					// Found customer lookup result
					if (result.found === true && result.customer) {
						info.customer_name = result.customer.name;
						info.customer_qbo_id = result.customer.qbo_id;
					}
				} catch {}
			}
			
			// Check user message for time entry details
			if (msg.role === 'user' && msg.content) {
				const content = this.extractTextContent(msg.content);
				const lowerContent = content.toLowerCase();
				
				// Extract hours - look for patterns like "16 Hours", "Total: 16 Hours", etc.
				const hoursPatterns = [
					/total[:\s]+(\d+(?:\.\d+)?)\s*hours?/i,
					/(\d+(?:\.\d+)?)\s*hours?/i,
				];
				for (const pattern of hoursPatterns) {
					const match = content.match(pattern);
					if (match && !info.hours) {
						info.hours = parseFloat(match[1]);
						break;
					}
				}
				
				// Extract date patterns
				const datePatterns = [
					/(\d{1,2}\/\d{1,2}\/\d{4})/,
					/(\d{4}-\d{2}-\d{2})/,
					/today/i,
					/yesterday/i,
				];
				for (const pattern of datePatterns) {
					const match = lowerContent.match(pattern);
					if (match && !info.entry_date) {
						if (match[0].toLowerCase() === 'today') {
							info.entry_date = new Date().toISOString().split('T')[0];
						} else if (match[0].toLowerCase() === 'yesterday') {
							const yesterday = new Date();
							yesterday.setDate(yesterday.getDate() - 1);
							info.entry_date = yesterday.toISOString().split('T')[0];
						} else if (match[1]) {
							info.entry_date = this.parseDate(match[1]);
						}
						break;
					}
				}
				
				// Extract tasks description - look for numbered lists or bullet points
				// Handle multi-line entries like "1. task one\n2. task two"
				const numberedListMatch = content.match(/(?:\d+\.\s*.+?(?:\n|$))+/i);
				if (numberedListMatch && !info.tasks_completed) {
					info.tasks_completed = numberedListMatch[0].trim();
				} else {
					// Extract tasks description (everything after "for" or "-")
					const forMatch = content.match(/(?:for|-\s*)(.+?)(?:\s+on\s+|\s+for\s+|\s*$)/i);
					if (forMatch && !info.tasks_completed) {
						info.tasks_completed = forMatch[1].trim();
					}
				}
			}
		}
		
		// Use logged-in user as employee if not found
		if (!info.employee_name && this.loggedInUser) {
			info.employee_name = this.loggedInUser.name;
		}
		
		return info;
	}

	/**
	 * Check if we have all required information for time entry
	 */
	private hasAllTimeEntryInfo(info: ReturnType<typeof this.extractTimeEntryInfo>): boolean {
		return !!(
			info.employee_name &&
			info.employee_qbo_id &&
			info.customer_name &&
			info.customer_qbo_id &&
			info.tasks_completed &&
			info.hours &&
			info.hours > 0
		);
	}

	// ==================== TOOL EXECUTION ====================

	async callTool(name: string, args: Record<string, any>): Promise<any> {
		try {
			switch (name) {
				// ==================== CALENDAR TOOLS ====================
				case 'get_users_with_name_and_email': {
					return await this.getCachedUsers();
				}

				case 'check_availability': {
					let userEmail = args.user_email;
					const date = args.date;
					const durationMinutes =
						typeof args.duration_minutes === 'number' && args.duration_minutes > 0
							? Math.round(args.duration_minutes)
							: 30;

					if (!userEmail.includes('@')) {
						if (!this.aiHelper) {
							throw new Error('Please provide user_email as an email address');
						}
						const usersList = await this.getCachedUsers();
						const targetUser = await this.aiHelper.matchUserName(userEmail, usersList);
						if (!targetUser) {
							throw new Error(`User '${userEmail}' not found. Use get_users_with_name_and_email to see available users.`);
						}
						userEmail = targetUser.email;
					}

					const parsedDate = this.parseDate(date);
					this.lastAvailabilityDate = parsedDate;
					const easternOffset = this.getEasternOffset(parsedDate);

					const dateObj = new Date(parsedDate + 'T00:00:00-05:00');
					const startDateTime = dateObj.toISOString();
					const nextDay = new Date(dateObj);
					nextDay.setDate(nextDay.getDate() + 1);
					const endDateTime = nextDay.toISOString();

					const events = await this.graphService.getUserCalendarView(userEmail, startDateTime, endDateTime);

					const busyTimes = events.value
						.filter((event) => !event.isAllDay)
						.map((event) => ({
							subject: event.subject,
							start: this.convertToLocalTime(event.start.dateTime),
							end: this.convertToLocalTime(event.end.dateTime),
							start_datetime: this.formatLocalDateTime(event.start.dateTime),
							end_datetime: this.formatLocalDateTime(event.end.dateTime),
						}));

					const availableSlots = await this.graphService.getAvailableSlotsForUser(
						userEmail,
						`${parsedDate}T08:00:00${easternOffset}`,
						`${parsedDate}T17:00:00${easternOffset}`,
						durationMinutes,
						'Eastern Standard Time'
					);

					const freeSlots = availableSlots.map((slot) => {
						const startLocal = this.convertToLocalTime(slot.start);
						const endLocal = this.convertToLocalTime(slot.end);
						const durationHours =
							(new Date(slot.end).getTime() - new Date(slot.start).getTime()) /
							(1000 * 60 * 60);
						return {
							start: startLocal,
							end: endLocal,
							duration_hours: Math.round(durationHours * 10) / 10,
						};
					});

					const displayDate = new Date(parsedDate + 'T00:00:00');
					const dayOfWeek = displayDate.toLocaleDateString('en-US', {
						weekday: 'long',
						timeZone: 'America/New_York',
					});

					return {
						user_email: userEmail,
						date: parsedDate,
						day_of_week: dayOfWeek,
						busy_times: busyTimes,
						total_events: busyTimes.length,
						free_slots: freeSlots,
						is_completely_free: busyTimes.length === 0,
						slot_minutes: durationMinutes,
						note: 'All times are in Eastern Time (EST/EDT)',
					};
				}

				case 'get_free_slots': {
					let userEmail = args.user_email;
					const date = args.date;
					const durationMinutes = typeof args.duration_minutes === 'number' && args.duration_minutes > 0
						? Math.round(args.duration_minutes)
						: 30;

					if (!userEmail.includes('@')) {
						if (!this.aiHelper) {
							throw new Error('Please provide user_email as an email address');
						}
						const usersList = await this.getCachedUsers();
						const targetUser = await this.aiHelper.matchUserName(userEmail, usersList);
						if (!targetUser) {
							throw new Error(`User '${userEmail}' not found. Use get_users_with_name_and_email to see available users.`);
						}
						userEmail = targetUser.email;
					}

					const parsedDate = this.parseDate(date);
					const easternOffset = this.getEasternOffset(parsedDate);
					const startDateTime = `${parsedDate}T08:00:00${easternOffset}`;
					const endDateTime = `${parsedDate}T17:00:00${easternOffset}`;
					const timeZone = 'Eastern Standard Time';

					const availableSlots = await this.graphService.getAvailableSlotsForUser(
						userEmail,
						startDateTime,
						endDateTime,
						durationMinutes,
						timeZone
					);

					const formattedSlots = availableSlots.map((slot) => {
						const startLocal = this.convertToLocalTime(slot.start);
						const endLocal = this.convertToLocalTime(slot.end);
						const durationHours = (new Date(slot.end).getTime() - new Date(slot.start).getTime()) / (1000 * 60 * 60);
						return {
							start: startLocal,
							end: endLocal,
							duration_hours: Math.round(durationHours * 10) / 10,
						};
					});

					const displayDate = new Date(parsedDate + 'T00:00:00');
					const dayOfWeek = displayDate.toLocaleDateString('en-US', {
						weekday: 'long',
						timeZone: 'America/New_York',
					});

					return {
						user_email: userEmail,
						date: parsedDate,
						day_of_week: dayOfWeek,
						free_slots: formattedSlots,
						slot_minutes: durationMinutes,
						note: 'All times are in Eastern Time (EST/EDT)',
					};
				}

				case 'book_meeting': {
					let { user_email, subject, start_datetime, end_datetime, attendees, body } = args;

					if (!subject?.trim()) {
						throw new Error('Meeting subject is REQUIRED. Please ask the user for the meeting subject/title.');
					}

					if (!this.loggedInUser) {
						throw new Error('No logged-in user information available.');
					}

					if (!this.aiHelper) {
						throw new Error('AI helper not available.');
					}

					const usersList = await this.getCachedUsers();
					const senderUser = await this.aiHelper.validateSender(
						this.loggedInUser.name,
						this.loggedInUser.email,
						usersList
					);

					if (!user_email.includes('@')) {
						const targetUser = await this.aiHelper.matchUserName(user_email, usersList);
						if (!targetUser) {
							throw new Error(`User '${user_email}' not found. Use get_users_with_name_and_email to see available users.`);
						}
						user_email = targetUser.email;
					}

					const dateStr = this.lastAvailabilityDate || new Date().toISOString().split('T')[0];
					const parseTimeInEastern = (timeStr: string): string => {
						const trimmed = timeStr.trim();
						if (trimmed.includes('T')) return trimmed;

						let normalized = trimmed;
						if (/^\d{3,4}$/.test(normalized)) {
							normalized = normalized.length === 3
								? `${normalized[0]}:${normalized.slice(1)}`
								: `${normalized.slice(0, 2)}:${normalized.slice(2)}`;
						}

						const timeMatch = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
						if (timeMatch) {
							let hours = parseInt(timeMatch[1], 10);
							const minutes = parseInt(timeMatch[2] || '0', 10);
							let period = timeMatch[3]?.toUpperCase();

							if (!period) {
								period = hours >= 1 && hours <= 11 ? 'AM' : 'PM';
								if (hours >= 13) hours -= 12;
							} else {
								if (period === 'PM' && hours !== 12) hours += 12;
								else if (period === 'AM' && hours === 12) hours = 0;
							}

							return `${dateStr}T${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
						}
						return trimmed;
					};

					const startISO = parseTimeInEastern(start_datetime);
					const endISO = parseTimeInEastern(end_datetime);

					const event = await this.graphService.createEventForUser(user_email, {
						subject,
						start: startISO,
						end: endISO,
						timeZone: 'Eastern Standard Time',
						senderName: senderUser.name,
						senderEmail: senderUser.email,
						attendees: attendees || [],
						body: body || '',
						isOnlineMeeting: true,
					});

					const startDt = new Date(startISO + '-05:00');
					const endDt = new Date(endISO + '-05:00');
					const teamsLink = (event as any).onlineMeeting?.joinUrl || null;

					return {
						id: event.id,
						subject: event.subject,
						validated_date_info: {
							subject,
							day_of_week: startDt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }),
							date_formatted: startDt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }),
							start_time: startDt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }),
							end_time: endDt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }),
							teams_link: teamsLink,
							sender_name: senderUser.name,
							sender_email: senderUser.email,
						},
					};
				}

				case 'lookup_employee': {
					const { name: employeeName } = args;
					if (!employeeName) throw new Error('Employee name is required');

					const employee = await getEmployeeByName(employeeName);
					if (!employee) {
						const allEmployees = await this.getCachedEmployees();
						return {
							found: false,
							error: `Employee "${employeeName}" not found`,
							suggestions: allEmployees.slice(0, 5).map((e) => e.name),
						};
					}
					return { found: true, employee: { name: employee.name, email: employee.email, qbo_id: employee.qbo_id } };
				}

				case 'lookup_customer': {
					const { name: customerName } = args;
					if (!customerName) throw new Error('Customer name is required');

					const customer = await getCustomerByName(customerName);
					if (!customer) {
						const allCustomers = await this.getCachedCustomers();
						return {
							found: false,
							error: `Customer "${customerName}" not found`,
							suggestions: allCustomers.slice(0, 5).map((c) => c.name),
						};
					}
					return { found: true, customer: { name: customer.name, qbo_id: customer.qbo_id } };
				}

				case 'list_employees': {
					const employees = await this.getCachedEmployees();
					return { employees: employees.map((e) => ({ name: e.name, email: e.email, qbo_id: e.qbo_id })), total: employees.length };
				}

				case 'list_customers': {
					const customers = await this.getCachedCustomers();
					return { customers: customers.map((c) => ({ name: c.name, qbo_id: c.qbo_id })), total: customers.length };
				}

				case 'submit_time_entry': {
					const {
						employee_name, employee_qbo_id, customer_name, customer_qbo_id,
						tasks_completed, hours, billable = true, entry_date,
					} = args;

					if (!employee_name || !employee_qbo_id) {
						throw new Error('STOP. You must call lookup_employee first to get the real QBO ID. Do not make up IDs.');
					}
					if (!customer_name || !customer_qbo_id) {
						throw new Error('STOP. You must call lookup_customer first to get the real QBO ID. Do not make up IDs.');
					}

					// REJECT FAKE/PLACEHOLDER IDs - must be real from database lookups
					// Note: QBO IDs can be single digits (e.g., "3" for Arvaya Administrative), so we only check patterns
					const fakeIdPatterns = /^(EMP|CUST|ID|QBO|TEST|PLACEHOLDER|XXX|000)/i;
					if (fakeIdPatterns.test(String(employee_qbo_id))) {
						throw new Error(`INVALID employee_qbo_id "${employee_qbo_id}". You MUST call lookup_employee("${employee_name}") first to get the real ID from the database.`);
					}
					if (fakeIdPatterns.test(String(customer_qbo_id))) {
						throw new Error(`INVALID customer_qbo_id "${customer_qbo_id}". You MUST call lookup_customer("${customer_name}") first to get the real ID from the database.`);
					}

					if (!tasks_completed) throw new Error('Tasks completed description is required');
					if (hours === undefined || hours <= 0) throw new Error('Hours must be positive');

					const timeEntry = {
						employee_name, employee_qbo_id, customer_name, customer_qbo_id,
						tasks_completed, hours: parseFloat(hours), billable: billable !== false,
						entry_date: entry_date || new Date().toISOString().split('T')[0],
						submitted_by: this.loggedInUser?.name || 'Unknown User',
						submitted_at: new Date().toISOString(),
					};

					if (!this.webhookUrl) {
						throw new Error('Webhook URL not configured for time entry submission');
					}

					const response = await fetch(this.webhookUrl, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ timeEntry }),
					});

					if (!response.ok) {
						throw new Error(`Failed to submit time entry: ${response.statusText}`);
					}

					const sanitizedTimeEntry = {
						employee_name: employee_name,
						customer_name: customer_name,
						tasks_completed: tasks_completed,
						hours: parseFloat(hours),
						billable: billable !== false,
						entry_date: entry_date || new Date().toISOString().split('T')[0],
						submitted_by: this.loggedInUser?.name || 'Unknown User',
					};

					return { 
						success: true, 
						message: 'Time entry submitted successfully', 
						timeEntry: sanitizedTimeEntry 
					};
				}

				default:
					throw new Error(`Unknown tool: ${name}`);
			}
		} catch (error: any) {
			console.error(`[UnifiedMCP] Tool error for ${name}:`, error);
			throw new Error(`Tool execution error: ${error.message}`);
		}
	}

	/**
	 * Handle streaming request
	 */
	async *handleRequestStream(request: UnifiedMCPRequest): AsyncGenerator<string> {
		const { message: userMessage } = request;

		if (!userMessage) {
			yield JSON.stringify({ error: 'Message is required' });
			return;
		}

		try {
			await this.loadHistory();

			if (this.hasMixedIntent(userMessage)) {
				const splitMessage =
					'I can help with either calendar scheduling or time entry in a single request. Which would you like to do first?';
				this.pushToHistory({ role: 'user', content: userMessage });
				this.pushToHistory({ role: 'assistant', content: splitMessage });
				yield splitMessage;
				await this.saveHistory();
				return;
			}

			const availabilityIntent = this.resolveAvailabilityIntent(userMessage);
			const toolScope = availabilityIntent ? 'calendar' : this.determineToolScope(userMessage);
			const tools =
				toolScope === 'calendar'
					? OpenAIService.createCalendarTools()
					: toolScope === 'billing'
						? OpenAIService.createTimeEntryTools()
						: OpenAIService.createAllTools();
			const preparedHistory = prepareChatHistory(this.chatHistory);

			// Fast path: direct availability check (skip LLM latency)
			if (availabilityIntent && toolScope === 'calendar') {
				this.pushToHistory({ role: 'user', content: userMessage });
				const toolCallId = `availability-${Date.now()}`;
				try {
					const toolResult = await this.callTool('check_availability', {
						user_email: availabilityIntent.name,
						date: availabilityIntent.date,
					});
					this.pushToHistory({
						role: 'tool',
						content: JSON.stringify(toolResult),
						toolCallId,
					});
					const responseText = this.formatAvailabilityResponse(toolResult);
					this.pushToHistory({ role: 'assistant', content: responseText });
					yield responseText;
					await this.saveHistory();
					return;
				} catch (error: any) {
					const errorText = `I couldn't check availability: ${error.message}`;
					this.pushToHistory({
						role: 'tool',
						content: JSON.stringify({ success: false, error: error.message }),
						toolCallId,
					});
					this.pushToHistory({ role: 'assistant', content: errorText });
					yield errorText;
					await this.saveHistory();
					return;
				}
			}

			// Get current date info for the AI
			const now = new Date();
			const todayStr = now.toISOString().split('T')[0];
			const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
			const formattedDate = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

			const systemMessage: GenericChatMessage = {
				role: 'system',
				content: `You are Billi, an AI assistant for Arvaya. You help with time tracking and calendar management.
			  
			  CURRENT DATE CONTEXT
			  - Today: ${dayOfWeek}, ${formattedDate} (${todayStr})
			  - "today" = ${todayStr}
			  - "yesterday" = ${new Date(now.getTime() - 86400000).toISOString().split('T')[0]}
			  
			  LOGGED-IN USER
			  - Name: ${this.loggedInUser?.name || 'Unknown'}
			  - Email: ${this.loggedInUser?.email || 'no email'}
			  - The logged-in user IS the employee and meeting organizer. Never ask them for their own name or email.
			  
			  WHAT YOU CAN DO (tell users this):
			  - Log time entries for projects (needs customer, hours, and description).
			  - Check calendar availability for team members.
			  - Book meetings with Teams links.
			  
			  GENERAL EXECUTION RULES (CRITICAL)
			  - If a user request can be completed with the available tools and information, you MUST execute the action instead of asking unnecessary questions.
			  - You may ask at most one short clarifying question only when a REQUIRED field is truly missing (e.g., no meeting subject).
			  - When you ask a yes/no question (e.g., "Would you like me to list all customers?"), a "yes" reply MUST trigger that action. Do not repeat the same error message.
			  - Do NOT ask the user for email addresses you can infer from names or from the logged-in user info. Pass names and let the backend resolve them.
			  - WHEN AN APPOINTMENT IS BOOKED, YOU MUST NOT LOG TIME FOR IT, NOT TRIGGER THE TIME ENTRY TOOL, BECAUSE IT IS IN THE FUTURE AND WE ARE NOT YET BILLED FOR IT.
			  
			  CALENDAR & MEETINGS
			  - You can:
				- Look up users by name and resolve them to their correct emails.
				- Check availability for a given person on a specific date (free slots come from Microsoft Graph schedule/free-busy data).
				- Book meetings on the logged-in user's calendar and invite others.
			  - When the user says "When is Zaki available on <date>?" you MUST:
				1) Treat this as a direct availability request.
				2) Use the name (e.g., "Zaki", "Zaki Queres(y)") to find the correct person.
				3) Call the availability tool for that person on that date.
			  - When the user says "I want a meeting with Zaki on <date> at <time>":
				- Assume the logged-in user is the organizer.
				- Use the same date from the request (or the most recent date used for availability if the user gives only a time).
				- Convert natural language time like "11", "11am", "11:30", "930" into a concrete start and end time using Eastern Time.
				- Book the meeting if there is no explicit conflict returned by the tools.
			  - You MUST NOT say "I need their email address" if you can pass a display name and let the backend resolve it.
			  -You Must NOT Call the time entry tool for bookings, even if it is a meeting, or for ice, we cannot have the time entries being made for meetings that we book, because they are in the future and we are not yet billed for them.
	
			  - After booking a meeting, always confirm:
				- Who the meeting is with.
				- Date and time range in Eastern Time.
				- That an invite has been created (and a Teams link if present).

			 - YOU MUST 
			  
			  TIME ENTRY WORKFLOW (CRITICAL - MUST FOLLOW)
			  1. When a user says "log 2 hours for ICE" or any similar phrasing, treat this as a request to create a time entry.
			  2. You MUST silently:
				 - Look up the employee using the logged-in user's name to get employee_qbo_id.
				 - Look up the customer (e.g., "ICE", "Arvaya") to get customer_qbo_id (use fuzzy matching if close).
			  3. Once you have employee and customer IDs, you MUST call the time-entry submission tool with ALL required fields:
				 - employee_name, employee_qbo_id
				 - customer_name, customer_qbo_id
				 - tasks_completed (description)
				 - hours (positive number)
				 - entry_date (YYYY-MM-DD; "today" = ${todayStr} unless user specifies another date)
				 - billable (true/false) ALL LOGS FOR ICE IS BILLABLE
				 - billable is ALWAYS FALSE FOR ARVAYA INTERNAL/ARVAYA CONSULTING/ANYTHING ARVAYA INTERNAL WORK IS NOT BILLABLE
			  4. ONLY AFTER the submission tool returns success=true may you confirm to the user, e.g.:
				 - "Logged 2 hours for Infrastructure Consulting & Engineering for today: API work."
			  
			  MULTI-TASK TIME ENTRIES
			  When the user provides multiple tasks in one message (for one or more customers):
			  1. Parse ALL entries in the message.
			  2. If all entries are for the SAME customer:
				 - Aggregate into ONE submission with summed hours and combined tasks description.
			  3. If entries reference DIFFERENT customers:
				 - Submit one time entry per customer.
				 - Each customer must be looked up before submission.
			  Patterns to recognize:
			  - Period-separated: "Customer - Task - X hours. Customer - Task - Y hours"
			  - Comma-separated: "Customer: Task A (2 hrs), Task B (1 hr)"
			  - Dash-separated: "Customer - Task A - 1 hour - Task B - 1 hour"
			  - Natural language: "2 hours for ICE on API work and 1 hour for Arvaya on docs"
			  - Bullet points or line breaks.
			  
			  CRITICAL LOGGING RULES
			  - NEVER claim to have logged time, submitted time, or created entries unless the submission tool has actually been called and returned success=true.
			  - If you have all required information for a time entry, you MUST call the submission tool immediately.
			  - If a lookup fails (employee or customer not found), do NOT keep repeating the same error:
				- Either:
				  - Use fuzzy matches when there is a clear single match, OR
				  - Ask the user to choose from a short list of suggestions, then try again.
			  
			  NAME & CUSTOMER HANDLING
			  - "Arvaya" and "Arvaya Consulting" should be treated as the same customer if the backend indicates a unique match.
			  - "ICE" is an alias for "Infrastructure Consulting & Engineering".
			  - When a provided name is close to exactly one known user/customer, use that match automatically.
			  - Only treat a name as "not found" if:
				- There is truly no plausible match, OR
				- There are several equally likely matches and you have already asked the user to choose.
			  
			  TIME & TIMEZONE
			  - All scheduling and availability are in Eastern Time (EST/EDT).
			  - When the user mentions "today" or "tomorrow", map those to real dates in YYYY-MM-DD format using the current date above.
			  - When the user provides a time without AM/PM (e.g., "11" or "930"), infer a reasonable AM/PM based on normal working hours (prefer 9–5 daytime) unless the user clearly indicates otherwise.
			  
			  SUMMARY OF BEHAVIOR
			  - Prefer taking real actions (checking availability, booking meetings, logging time) over asking redundant questions.
			  - Use the backend's ability to resolve names to emails and IDs; do not block on information that can be inferred.
			  - Minimize refusals and generic "unable to" messages. If something fails, explain clearly what went wrong and suggest a specific next step (e.g., "I couldn't find that customer; here are the closest matches: ... Which one should I use?").`,
			  };
				  

			// Add user message to history
			this.pushToHistory({ role: 'user', content: userMessage });

			// AGENTIC LOOP - keep executing tools until done (max 5 iterations)
			const MAX_ITERATIONS = 5;
			let iteration = 0;
			let timeEntryActuallySubmitted = false;
			let timeEntryError: string | null = null;
			let currentMessage = userMessage;
			let forcedAvailabilityAttempted = false;

			while (iteration < MAX_ITERATIONS) {
				iteration++;
				console.log(`[UnifiedMCP] Agentic loop iteration ${iteration}`);

				const preparedHistory = prepareChatHistory(this.chatHistory);
				let fullText = '';
				const toolCalls: any[] = [];

				// Call OpenAI and collect response WITHOUT yielding text
				for await (const chunk of this.openaiService.chatStream(
					currentMessage,
					tools,
					[systemMessage, ...preparedHistory],
					undefined
				)) {
					if (chunk.type === 'text' && chunk.content) {
						fullText += chunk.content;
					} else if (chunk.type === 'tool_call' && chunk.toolCall) {
						toolCalls.push(chunk.toolCall);
					} else if (chunk.type === 'error') {
						yield '\n\n[Error: ' + chunk.error + ']';
						return;
					}
				}

				// Check if AI claims to have logged time but didn't call the tool
				const claimsLogged = this.claimsToHaveLoggedTime(fullText);
				const hasSubmitCall = toolCalls.some(tc => tc.name === 'submit_time_entry');
				
				// If AI claims to have logged but didn't call tool, check if we can force it
				if (claimsLogged && !hasSubmitCall && !timeEntryActuallySubmitted) {
					const timeEntryInfo = this.extractTimeEntryInfo();
					
					if (this.hasAllTimeEntryInfo(timeEntryInfo)) {
						console.log('[UnifiedMCP] AI claimed to log time but didn\'t call tool. Forcing submit_time_entry with extracted info:', timeEntryInfo);
						// Force the tool call
						toolCalls.push({
							id: `forced-${Date.now()}`,
							name: 'submit_time_entry',
							parameters: {
								employee_name: timeEntryInfo.employee_name,
								employee_qbo_id: timeEntryInfo.employee_qbo_id,
								customer_name: timeEntryInfo.customer_name,
								customer_qbo_id: timeEntryInfo.customer_qbo_id,
								tasks_completed: timeEntryInfo.tasks_completed,
								hours: timeEntryInfo.hours,
								entry_date: timeEntryInfo.entry_date || new Date().toISOString().split('T')[0],
								billable: true,
							},
						});
					} else {
						// Missing info - force another iteration to get it
						console.log('[UnifiedMCP] AI claimed to log time but missing info. Forcing lookup.', timeEntryInfo);
						currentMessage = `You claimed to have logged time, but you must actually call submit_time_entry. First call lookup_employee and lookup_customer if needed, then call submit_time_entry with all required fields. Do not claim success until the tool is called.`;
						continue;
					}
				}

				// If availability is clearly requested, ensure we call the graph tool
				if (!forcedAvailabilityAttempted) {
					const hasAvailabilityCall = toolCalls.some((tc) => tc.name === 'check_availability');
					if (availabilityIntent && !hasAvailabilityCall) {
						forcedAvailabilityAttempted = true;
						toolCalls.push({
							id: `forced-availability-${Date.now()}`,
							name: 'check_availability',
							parameters: {
								user_email: availabilityIntent.name,
								date: availabilityIntent.date,
							},
						});
					}
				}

				// No tool calls = done, yield final response
				if (toolCalls.length === 0) {
					const responseText = fullText || 'How can I help you today?';
					yield responseText;
					this.pushToHistory({ role: 'assistant', content: responseText });
					break;
				}

				// Tool calls present - execute them silently
				const assistantMessage: GenericChatMessage = { role: 'assistant' };
				// Set content if any, and add tool calls
				assistantMessage.toolCalls = toolCalls.map((tc) => ({
					id: tc.id,
					type: 'function' as const,
					function: { name: tc.name, arguments: JSON.stringify(tc.parameters) },
				}));
				this.pushToHistory(assistantMessage);

				// Execute tools
				const toolResults: GenericChatMessage[] = [];
				for (const toolCall of toolCalls) {
					try {
						console.log(`[UnifiedMCP] Executing tool: ${toolCall.name}`);
						const result = await this.callTool(toolCall.name, toolCall.parameters);

						if (toolCall.name === 'submit_time_entry' && result.success === true) {
							timeEntryActuallySubmitted = true;
							console.log(`[UnifiedMCP] TIME ENTRY SUBMITTED SUCCESSFULLY`);
						}

						toolResults.push({ role: 'tool', content: JSON.stringify(result), toolCallId: toolCall.id });
					} catch (error: any) {
						if (toolCall.name === 'submit_time_entry') {
							timeEntryError = error.message;
						}
						toolResults.push({
							role: 'tool',
							content: JSON.stringify({ success: false, error: error.message, tool: toolCall.name }),
							toolCallId: toolCall.id,
						});
					}
				}

				this.pushToHistory(...toolResults);

				// Set next iteration prompt - tell AI to continue or report results
				if (timeEntryActuallySubmitted) {
					currentMessage = 'Time entry was submitted successfully. Confirm to user with details (no QBO IDs).';
				} else if (timeEntryError) {
					currentMessage = `Time entry failed: ${timeEntryError}. Report this error to user.`;
				} else {
					// Check if we have lookup results but didn't submit
					const hasLookups = toolCalls.some(tc => 
						tc.name === 'lookup_employee' || tc.name === 'lookup_customer'
					);
					if (hasLookups) {
						currentMessage = 'You have lookup results. You MUST now call submit_time_entry with the employee_qbo_id and customer_qbo_id from the lookup results. Do not claim success without calling the tool.';
					} else {
						currentMessage = 'Continue with the task. If you have all the information needed (employee, customer, hours, tasks), you MUST call submit_time_entry. Never claim to have logged time without calling the tool.';
					}
				}
			}

			if (iteration >= MAX_ITERATIONS) {
				yield 'I was unable to complete the request after multiple attempts. Please try again with more specific information.';
			}

			await this.saveHistory();
		} catch (error: any) {
			console.error('[UnifiedMCP] Stream error:', error);
			yield '\n\n[Error: ' + error.message + ']';
		}
	}

	clearHistory(): void {
		this.chatHistory = [];
		this.historyLoaded = false;
	}
}
