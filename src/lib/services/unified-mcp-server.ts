
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

	// ==================== TIME ENTRY DETECTION ====================

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
						throw new Error('STOP. You must call lookup_employee first to get the real QBO ID. Do not make up IDs.');
					}
					if (!customer_name || !customer_qbo_id) {
						throw new Error('STOP. You must call lookup_customer first to get the real QBO ID. Do not make up IDs.');
					}

					// REJECT FAKE/PLACEHOLDER IDs - must be real from database lookups
					const fakeIdPatterns = /^(EMP|CUST|ID|QBO|TEST|PLACEHOLDER|XXX|000)/i;
					if (fakeIdPatterns.test(employee_qbo_id) || employee_qbo_id.length < 3) {
						throw new Error(`INVALID employee_qbo_id "${employee_qbo_id}". You MUST call lookup_employee("${employee_name}") first to get the real ID from the database.`);
					}
					if (fakeIdPatterns.test(customer_qbo_id) || customer_qbo_id.length < 3) {
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

			const tools = CohereService.createAllTools();
			const preparedHistory = prepareChatHistory(this.chatHistory);

			// Get current date info for the AI
			const now = new Date();
			const todayStr = now.toISOString().split('T')[0];
			const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
			const formattedDate = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

			const systemMessage: ChatMessageV2 = {
				role: 'system',
				content: `You are Billi, an AI assistant for Arvaya. You help with time tracking and calendar management.

**CURRENT DATE: ${dayOfWeek}, ${formattedDate} (${todayStr})**
- "today" = ${todayStr}
- "yesterday" = ${new Date(now.getTime() - 86400000).toISOString().split('T')[0]}

**LOGGED-IN USER: ${this.loggedInUser?.name || 'Unknown'} (${this.loggedInUser?.email || 'no email'})**

**WHAT YOU CAN DO (tell users this):**
- Log time entries for projects (just need customer, hours, and description)
- Check calendar availability for team members
- Book meetings with Teams links

**INTERNAL TOOLS (never mention these to users):**
- lookup_employee, lookup_customer, list_employees, list_customers - use these internally
- QBO IDs - NEVER mention these exist

**TIME ENTRY WORKFLOW (CRITICAL - MUST FOLLOW):**
1. User says "log 2 hours for ICE" or similar
2. You MUST silently call lookup_employee("${this.loggedInUser?.name || ''}") to get employee_qbo_id
3. You MUST silently call lookup_customer("ICE") to get customer_qbo_id
4. You MUST call submit_time_entry with ALL required fields (employee_name, employee_qbo_id, customer_name, customer_qbo_id, tasks_completed, hours, entry_date)
5. ONLY AFTER submit_time_entry returns success=true, you confirm: "Logged 2 hours for Infrastructure Consulting & Engineering"

**CRITICAL RULES:**
- NEVER claim to have logged time without actually calling submit_time_entry
- NEVER say "Logged X hours" unless submit_time_entry tool was called and returned success=true
- You MUST call submit_time_entry when user requests time logging - it is REQUIRED, not optional
- If you have all the information (employee, customer, hours, tasks), you MUST call submit_time_entry immediately
- The logged-in user IS the employee - never ask for their name
- "Arvaya" and "ICE" are customers
- All times are Eastern Time
- When user says "today", use entry_date="${todayStr}" (YYYY-MM-DD format)
- NEVER mention QuickBooks, QBO, IDs, or internal lookups to users`,
			};

			// Add user message to history
			this.pushToHistory({ role: 'user', content: userMessage });

			// AGENTIC LOOP - keep executing tools until done (max 5 iterations)
			const MAX_ITERATIONS = 5;
			let iteration = 0;
			let timeEntryActuallySubmitted = false;
			let timeEntryError: string | null = null;
			let currentMessage = userMessage;

			while (iteration < MAX_ITERATIONS) {
				iteration++;
				console.log(`[UnifiedMCP] Agentic loop iteration ${iteration}`);

				const preparedHistory = prepareChatHistory(this.chatHistory);
				let fullText = '';
				const toolCalls: any[] = [];

				// Call Cohere and collect response WITHOUT yielding text
				for await (const chunk of this.cohereService.chatStream(
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

				// No tool calls = done, yield final response
				if (toolCalls.length === 0) {
					const responseText = fullText || 'How can I help you today?';
					yield responseText;
					this.pushToHistory({ role: 'assistant', content: responseText });
					break;
				}

				// Tool calls present - execute them silently
				const assistantMessage: ChatMessageV2 = { role: 'assistant' };
				if (fullText) assistantMessage.content = fullText;
				assistantMessage.toolCalls = toolCalls.map((tc) => ({
					id: tc.id,
					type: 'function' as const,
					function: { name: tc.name, arguments: JSON.stringify(tc.parameters) },
				}));
				this.pushToHistory(assistantMessage);

				// Execute tools
				const toolResults: ChatMessageV2[] = [];
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
