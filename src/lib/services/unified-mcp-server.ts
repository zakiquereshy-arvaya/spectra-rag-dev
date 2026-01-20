
import type { ChatMessageV2 } from 'cohere-ai/api';
import { CohereService } from './cohere';
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

// Extended message type with timestamp for storage
type StoredChatMessage = ChatMessageV2 & { _timestamp?: string };

export interface UnifiedMCPRequest {
	message: string;
	sessionId: string;
}

export class UnifiedMCPServer {
	private cohereService: CohereService;
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
		cohereApiKey: string,
		sessionId: string,
		authService?: MicrosoftGraphAuth,
		accessToken?: string,
		loggedInUser?: { name: string; email: string },
		webhookUrl?: string
	) {
		this.cohereService = new CohereService(cohereApiKey);
		this.graphService = new MicrosoftGraphService(accessToken, authService);
		try {
			this.aiHelper = new CalendarAIHelper(cohereApiKey);
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
	private pushToHistory(...messages: ChatMessageV2[]): void {
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
		if (lower.match(/^\d{4}-\d{2}-\d{2}$/)) {
			return lower;
		}

		const parsedDate = new Date(dateString);
		if (!isNaN(parsedDate.getTime())) {
			return parsedDate.toISOString().split('T')[0];
		}

		return today.toISOString().split('T')[0];
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
						is_completely_free: busyTimes.length === 0,
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
						throw new Error('Employee name and QBO ID required. Use lookup_employee first.');
					}
					if (!customer_name || !customer_qbo_id) {
						throw new Error('Customer name and QBO ID required. Use lookup_customer first.');
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

			const tools = CohereService.createAllTools();
			const preparedHistory = prepareChatHistory(this.chatHistory);

			const systemMessage: ChatMessageV2 = {
				role: 'system',
				content: `You are Billi, an AI agent for Arvaya. You execute tasks by calling tools.

**Your Tools:**
- get_users_with_name_and_email: Get user emails
- check_availability: Check calendar (needs user_email, date)
- book_meeting: Create meetings
- lookup_employee: Find employee QBO ID
- lookup_customer: Find customer QBO ID
- list_employees/list_customers: List all
- submit_time_entry: Submit time (needs QBO IDs from lookups)

**Rules:**
- For availability checks: call get_users first, then check_availability for EACH person
- For time entries: call lookup_employee AND lookup_customer, then submit_time_entry
- All times are Eastern Time
- NEVER show QBO IDs in responses
- Logged-in user: ${this.loggedInUser?.name || 'Unknown'} (${this.loggedInUser?.email || 'no email'})`,
			};

			// IMPORTANT: Buffer ALL initial response - don't yield text until we know if there are tool calls
			let fullText = '';
			const toolCalls: any[] = [];

			// First, collect the ENTIRE response (text + tool calls) without yielding
			for await (const chunk of this.cohereService.chatStream(
				userMessage,
				tools,
				[systemMessage, ...preparedHistory],
				undefined
			)) {
				if (chunk.type === 'text' && chunk.content) {
					fullText += chunk.content;
					// DON'T yield text here - buffer it
				} else if (chunk.type === 'tool_call' && chunk.toolCall) {
					toolCalls.push(chunk.toolCall);
				} else if (chunk.type === 'error') {
					yield '\n\n[Error: ' + chunk.error + ']';
					return;
				}
			}

			this.pushToHistory({ role: 'user', content: userMessage });

			if (toolCalls.length > 0) {
				// Tool calls present - DON'T show the buffered text, just process tools silently

				const assistantMessage: ChatMessageV2 = { role: 'assistant' };
				if (fullText) assistantMessage.content = fullText;
				assistantMessage.toolCalls = toolCalls.map((tc) => ({
					id: tc.id,
					type: 'function' as const,
					function: { name: tc.name, arguments: JSON.stringify(tc.parameters) },
				}));
				if (!assistantMessage.content && !assistantMessage.toolCalls) {
					assistantMessage.content = 'Processing...';
				}
				this.pushToHistory(assistantMessage);

				const toolResults: ChatMessageV2[] = [];
				for (const toolCall of toolCalls) {
					try {
						console.log(`[UnifiedMCP] Executing tool: ${toolCall.name}`);
						const result = await this.callTool(toolCall.name, toolCall.parameters);
						toolResults.push({ role: 'tool', content: JSON.stringify(result), toolCallId: toolCall.id });
					} catch (error: any) {
						toolResults.push({
							role: 'tool',
							content: JSON.stringify({ success: false, error: error.message, tool: toolCall.name }),
							toolCallId: toolCall.id,
						});
					}
				}

				this.pushToHistory(...toolResults);

				const preparedHistoryForFinal = prepareChatHistory(this.chatHistory);
				let finalFullText = '';

				// Check if submit_time_entry was called - if so, provide specific instructions
				const hasTimeEntrySubmission = toolCalls.some(tc => tc.name === 'submit_time_entry');
				const finalPrompt = hasTimeEntrySubmission
					? `Based on the tool results, provide a clear confirmation to the user. IMPORTANT: For time entry confirmations, show ONLY the employee name and customer name (NO QBO IDs). Display the tasks_completed summary nicely formatted. This summary is what gets sent to the workflow and placed on Monday/QBO. Never mention QBO IDs or CustomerId fields in your response.`
					: 'Based on the tool results, provide a clear and helpful response to the user.';

				for await (const chunk of this.cohereService.chatStream(
					finalPrompt,
					tools,
					[systemMessage, ...preparedHistoryForFinal],
					'NONE'
				)) {
					if (chunk.type === 'text' && chunk.content) {
						finalFullText += chunk.content;
						yield chunk.content;
					}
				}

				this.pushToHistory({ role: 'assistant', content: finalFullText || 'Request processed.' });
			} else {
				// No tool calls - yield the buffered text to the user
				const responseText = fullText || 'How can I help you today?';
				yield responseText;
				this.pushToHistory({ role: 'assistant', content: responseText });
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
