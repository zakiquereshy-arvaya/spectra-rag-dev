// MCP Server Implementation for Microsoft Graph Calendar Operations

import type {
	MCPRequest,
	MCPResponse,
	MCPTool,
	MCPToolsCallRequest,
	MCPToolsCallResponse,
} from '$lib/types/mcp';
import { MicrosoftGraphService } from './microsoft-graph';
import { MicrosoftGraphAuth } from './microsoft-graph-auth';
import { CohereService } from './cohere';
import { CalendarAIHelper } from './ai-calendar-helpers';
import type { ChatMessageV2 } from 'cohere-ai/api';
import { getChatHistory, setChatHistory } from './chat-history-store';

export class MCPServer {
	private graphService: MicrosoftGraphService;
	private cohereService: CohereService;
	private aiHelper: CalendarAIHelper | null;
	private sessionId: string;
	private chatHistory: ChatMessageV2[] = [];
	private loggedInUser: { name: string; email: string } | null = null;
	private lastAvailabilityDate: string | null = null;

	/**
	 * Parse natural language date strings like "next monday", "tomorrow", "1/12/2026"
	 * Returns date in YYYY-MM-DD format
	 */
	private parseDate(dateString: string | undefined | null): string {
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
			const dayMap: Record<string, number> = {
				sunday: 0,
				monday: 1,
				tuesday: 2,
				wednesday: 3,
				thursday: 4,
				friday: 5,
				saturday: 6,
			};
			const targetDay = dayMap[dayName];
			const nextDate = new Date(today);
			const daysUntil = (targetDay - today.getDay() + 7) % 7 || 7; // If today, get next week's
			nextDate.setDate(today.getDate() + daysUntil);
			return nextDate.toISOString().split('T')[0];
		}

		const thisDayMatch = lower.match(/this\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
		if (thisDayMatch) {
			const dayName = thisDayMatch[1];
			const dayMap: Record<string, number> = {
				sunday: 0,
				monday: 1,
				tuesday: 2,
				wednesday: 3,
				thursday: 4,
				friday: 5,
				saturday: 6,
			};
			const targetDay = dayMap[dayName];
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

	
	private convertToLocalTime(utcDateTime: string): string {
		const date = new Date(utcDateTime);
		return date.toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true,
			timeZone: 'America/New_York', // EST/EDT
		});
	}

	
	private formatLocalDateTime(utcDateTime: string): string {
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
	 * Parse local time string like "9:00 AM" to a Date object
	 * @param timeStr - Time string like "9:00 AM" or "2:30 PM"
	 * @param dateStr - Optional date string in YYYY-MM-DD format, defaults to today
	 */
	private parseLocalTime(timeStr: string, dateStr?: string): Date {
		const baseDate = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
		const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
		if (!match) {
			throw new Error(`Invalid time format: ${timeStr}`);
		}
		let hours = parseInt(match[1], 10);
		const minutes = parseInt(match[2], 10);
		const period = match[3].toUpperCase();

		if (period === 'PM' && hours !== 12) {
			hours += 12;
		} else if (period === 'AM' && hours === 12) {
			hours = 0;
		}

		// Create date in EST/EDT timezone
		const date = new Date(baseDate);
		date.setHours(hours, minutes, 0, 0);
		return date;
	}

	constructor(
		cohereApiKey: string,
		sessionId: string,
		authService?: MicrosoftGraphAuth,
		accessToken?: string,
		loggedInUser?: { name: string; email: string }
	) {
		this.graphService = new MicrosoftGraphService(accessToken, authService);
		this.cohereService = new CohereService(cohereApiKey);
		try {
			this.aiHelper = new CalendarAIHelper(cohereApiKey);
		} catch (error) {
			console.warn('AI helper initialization failed:', error);
			this.aiHelper = null;
		}
		this.sessionId = sessionId;
		this.chatHistory = getChatHistory(sessionId);
		this.loggedInUser = loggedInUser || null;
	}

	/**
	 * Get available MCP tools
	 * Based on Python FastMCP implementation
	 */
	getTools(): MCPTool[] {
		return [
			{
				name: 'get_users_with_name_and_email',
				description: 'Get a list of all users with their display names and email addresses. Use this first to find the correct email address before checking availability or booking meetings.',
				inputSchema: {
					type: 'object',
					properties: {},
					required: [],
				},
			},
			{
				name: 'check_availability',
				description: 'Check calendar availability for a user on a specific date. IMPORTANT: For best results, first call get_users_with_name_and_email to get the correct email address, then pass that email here. Returns busy times and free slots for the day. Supports natural language dates like "next monday", "tomorrow", "1/12/2026", or YYYY-MM-DD format.',
				inputSchema: {
					type: 'object',
					properties: {
						user_email: {
							type: 'string',
							description: 'The email address or display name of the user to check availability for. If a name is provided, it will be matched against users from get_users_with_name_and_email.',
						},
						date: {
							type: 'string',
							description: 'The date to check. Supports natural language like "next monday", "tomorrow", "this friday", or date formats like "1/12/2026" or "2026-01-12". Defaults to today if not provided.',
						},
					},
					required: ['user_email'],
				},
			},
			{
				name: 'book_meeting',
				description: 'Book a meeting on a user\'s calendar. IMPORTANT: sender_email MUST be provided - call get_users_with_name_and_email first to get it. Creates a Teams meeting automatically.',
				inputSchema: {
					type: 'object',
					properties: {
						user_email: {
							type: 'string',
							description: 'The email address or display name of the user whose calendar to book on.',
						},
						subject: {
							type: 'string',
							description: 'The subject/title of the meeting',
						},
						start_datetime: {
							type: 'string',
							description: 'Start time in YYYY-MM-DDTHH:MM:SS format (e.g., 2024-01-15T14:00:00)',
						},
						end_datetime: {
							type: 'string',
							description: 'End time in YYYY-MM-DDTHH:MM:SS format (e.g., 2024-01-15T15:00:00)',
						},
						sender_name: {
							type: 'string',
							description: 'The display name of the person booking the meeting',
						},
						sender_email: {
							type: 'string',
							description: 'REQUIRED - The email address of the person booking the meeting. Must be obtained from get_users_with_name_and_email first.',
						},
						attendees: {
							type: 'array',
							description: 'Optional list of attendee email addresses',
						},
						body: {
							type: 'string',
							description: 'Optional meeting body/description',
						},
					},
					required: ['user_email', 'subject', 'start_datetime', 'end_datetime', 'sender_name', 'sender_email'],
				},
			},
		];
	}

	/**
	 * Execute a tool call
	 * Based on Python FastMCP implementation
	 */
	async callTool(name: string, args: Record<string, any>): Promise<any> {
		try {
			switch (name) {
				case 'get_users_with_name_and_email': {
					const users = await this.graphService.listUsers();
					return users.value.map((user) => ({
						name: user.displayName,
						email: user.mail || user.userPrincipalName,
					}));
				}

				case 'check_availability': {
					let userEmail = args.user_email;
					let date = args.date;
					
					if (!userEmail.includes('@')) {
						if (!this.aiHelper) {
							throw new Error(
								'AI helper not available. Please provide user_email as an email address, ' +
									'or ensure Cohere API is configured.'
							);
						}
						
						const users = await this.graphService.listUsers();
						const usersList = users.value.map((u) => ({
							name: u.displayName,
							email: u.mail || u.userPrincipalName,
						}));
						
						const targetUser = await this.aiHelper.matchUserName(userEmail, usersList);
						
						if (!targetUser) {
							const availableNames = users.value.slice(0, 5).map((u) => u.displayName);
							throw new Error(
								`User '${userEmail}' not found or ambiguous. ` +
									`Please use get_users_with_name_and_email tool first to get the correct email address. ` +
									`Example names found: ${availableNames.join(', ')}`
							);
						}
						
						userEmail = targetUser.email;
					}
					
					// Parse natural language date (handles "next monday", "tomorrow", etc.)
					const parsedDate = this.parseDate(date);
					
					// Create datetime range for the full day in EST/EDT timezone
					// Convert local midnight to UTC for the query
					const dateObj = new Date(parsedDate + 'T00:00:00-05:00'); // EST offset
					const startDateTime = dateObj.toISOString();
					const nextDay = new Date(dateObj);
					nextDay.setDate(nextDay.getDate() + 1);
					const endDateTime = nextDay.toISOString();

					// Get calendar view for the user
					const events = await this.graphService.getUserCalendarView(
						userEmail,
						startDateTime,
						endDateTime
					);

					const busyTimes = events.value
						.filter((event) => !event.isAllDay)
						.map((event) => {
							const startLocal = this.convertToLocalTime(event.start.dateTime);
							const endLocal = this.convertToLocalTime(event.end.dateTime);
							return {
								subject: event.subject,
								start: startLocal,
								end: endLocal,
								start_datetime: this.formatLocalDateTime(event.start.dateTime),
								end_datetime: this.formatLocalDateTime(event.end.dateTime),
								start_utc: event.start.dateTime,
								end_utc: event.end.dateTime,
							};
						});

					const freeSlots = this.calculateFreeSlots(busyTimes, parsedDate);

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
						note: 'All times are displayed in Eastern Time (EST/EDT)',
					};
				}

				case 'book_meeting': {
					let {
						user_email,
						subject,
						start_datetime,
						end_datetime,
						attendees,
						body,
					} = args;

					if (!subject || !subject.trim()) {
						throw new Error(
							'Meeting subject is REQUIRED. Please ask the user for the meeting subject/title before booking.'
						);
					}

					if (!this.loggedInUser) {
						throw new Error(
							'No logged-in user information available. Please ensure you are authenticated.'
						);
					}

					if (!this.aiHelper) {
						throw new Error(
							'AI helper not available. Please ensure Cohere API is configured.'
						);
					}

					const users = await this.graphService.listUsers();
					const usersList = users.value.map((u) => ({
						name: u.displayName,
						email: u.mail || u.userPrincipalName,
					}));

					const senderUser = await this.aiHelper.validateSender(
						this.loggedInUser.name,
						this.loggedInUser.email,
						usersList
					);
					const validatedSenderEmail = senderUser.email;
					const validatedSenderName = senderUser.name;

					if (!user_email.includes('@')) {
						const targetUser = await this.aiHelper.matchUserName(user_email, usersList);
						
						if (!targetUser) {
							const availableNames = users.value.slice(0, 5).map((u) => u.displayName);
							throw new Error(
								`User '${user_email}' not found or ambiguous. ` +
									`Please use get_users_with_name_and_email tool first to get the correct email address. ` +
									`Example names found: ${availableNames.join(', ')}`
							);
						}
						
						user_email = targetUser.email;
					}

					// Parse and validate datetime format
					// Handle natural language times like "9", "9:30", "9 AM", "9:30 PM"
					// If only time is provided, assume today's date
					let startDt: Date;
					let endDt: Date;

					// Helper to parse time strings like "9", "930", "9:30", "9 AM", "9:30 PM"
					const parseTimeString = (timeStr: string, baseDate: Date): Date => {
						const trimmed = timeStr.trim();
						
						if (trimmed.includes('T') || trimmed.match(/^\d{4}-\d{2}-\d{2}/)) {
							return new Date(trimmed);
						}
						
						let normalized = trimmed;
						if (/^\d{3,4}$/.test(normalized) && !normalized.includes(':')) {
							if (normalized.length === 3) {
								normalized = `${normalized[0]}:${normalized.slice(1)}`;
							} else if (normalized.length === 4) {
								normalized = `${normalized.slice(0, 2)}:${normalized.slice(2)}`;
							}
						}
						
						const timeMatch = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
						if (timeMatch) {
							let hours = parseInt(timeMatch[1], 10);
							const minutes = parseInt(timeMatch[2] || '0', 10);
							const period = timeMatch[3]?.toUpperCase();
							
							if (!period) {
								if (hours >= 12) {
									hours = hours === 12 ? 12 : hours;
								}
							} else {
								if (period === 'PM' && hours !== 12) hours += 12;
								else if (period === 'AM' && hours === 12) hours = 0;
							}
							
							const result = new Date(baseDate);
							result.setHours(hours, minutes, 0, 0);
							return result;
						}
						
						return new Date(trimmed);
					};

					const baseDate = this.lastAvailabilityDate 
						? new Date(this.lastAvailabilityDate + 'T00:00:00')
						: new Date();
					startDt = parseTimeString(start_datetime, baseDate);
					endDt = parseTimeString(end_datetime, startDt);
					
					if (isNaN(startDt.getTime()) || isNaN(endDt.getTime())) {
						throw new Error(`Invalid datetime format. Received start: "${start_datetime}", end: "${end_datetime}". Use YYYY-MM-DDTHH:MM:SS format or time like "9:00 AM".`);
					}

					if (endDt <= startDt) {
						throw new Error('End time must be after start time');
					}

					const startISO = startDt.toISOString();
					const endISO = endDt.toISOString();

					const event = await this.graphService.createEventForUser(user_email, {
						subject,
						start: startISO,
						end: endISO,
						timeZone: 'Eastern Standard Time',
						senderName: validatedSenderName,
						senderEmail: validatedSenderEmail,
						attendees: attendees || [],
						body: body || '',
						isOnlineMeeting: true,
					});

					const dayOfWeek = startDt.toLocaleDateString('en-US', { weekday: 'long' });
					const dateFormatted = startDt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
					const startTime = startDt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
					const endTime = endDt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
					const durationMinutes = Math.round((endDt.getTime() - startDt.getTime()) / 60000);

					const teamsLink = (event as any).onlineMeeting?.joinUrl || null;

					return {
						id: event.id,
						subject: event.subject,
						start: event.start.dateTime,
						end: event.end.dateTime,
						validated_date_info: {
							subject,
							day_of_week: dayOfWeek,
							date_formatted: dateFormatted,
							start_time: startTime,
							end_time: endTime,
							duration_minutes: durationMinutes,
							teams_link: teamsLink,
							has_teams_link: teamsLink !== null,
							attendee_emails: attendees || [],
							sender_name: validatedSenderName,
							sender_email: validatedSenderEmail,
						},
					};
				}

				default:
					throw new Error(`Unknown tool: ${name}`);
			}
		} catch (error: any) {
			console.error(`Tool execution error for ${name}:`, {
				error: error.message,
				stack: error.stack,
				args: args,
			});
			// Preserve the full error message so it can be seen
			throw new Error(`Tool execution error: ${error.message}`);
		}
	}

	/**
	 * Calculate free slots based on business hours (9am-5pm)
	 * busyTimes now has start/end as local time strings like "9:00 AM"
	 */
	private calculateFreeSlots(busyTimes: Array<{ start: string; end: string; start_utc?: string; end_utc?: string }>, date: string): Array<{ start: string; end: string; duration_hours: number }> {
		if (busyTimes.length === 0) {
			return [{
				start: '9:00 AM',
				end: '5:00 PM',
				duration_hours: 8,
			}];
		}

		// Sort by UTC times if available, otherwise by local time strings
		const sortedBusy = [...busyTimes].sort((a, b) => {
			if (a.start_utc && b.start_utc) {
				return new Date(a.start_utc).getTime() - new Date(b.start_utc).getTime();
			}
			// Fallback: parse local time strings
			return this.parseLocalTime(a.start).getTime() - this.parseLocalTime(b.start).getTime();
		});

		const freeSlots: Array<{ start: string; end: string; duration_hours: number }> = [];
		const businessStart = this.parseLocalTime('9:00 AM');
		const businessEnd = this.parseLocalTime('5:00 PM');

		// Helper to parse local time string like "9:00 AM" to a Date object for the given date
		const parseTimeOnDate = (timeStr: string): Date => {
			return this.parseLocalTime(timeStr, date);
		};

		// Check if there's free time before first meeting
		const firstMeetingStart = parseTimeOnDate(sortedBusy[0].start);
		if (firstMeetingStart > businessStart) {
			const duration = (firstMeetingStart.getTime() - businessStart.getTime()) / (1000 * 60 * 60);
			if (duration > 0) {
				freeSlots.push({
					start: '9:00 AM',
					end: sortedBusy[0].start,
					duration_hours: Math.round(duration * 10) / 10,
				});
			}
		}

		// Check gaps between meetings
		for (let i = 0; i < sortedBusy.length - 1; i++) {
			const currentEnd = parseTimeOnDate(sortedBusy[i].end);
			const nextStart = parseTimeOnDate(sortedBusy[i + 1].start);
			
			if (nextStart > currentEnd) {
				const duration = (nextStart.getTime() - currentEnd.getTime()) / (1000 * 60 * 60);
				if (duration > 0) {
					freeSlots.push({
						start: sortedBusy[i].end,
						end: sortedBusy[i + 1].start,
						duration_hours: Math.round(duration * 10) / 10,
					});
				}
			}
		}

		// Check if there's free time after last meeting
		const lastMeetingEnd = parseTimeOnDate(sortedBusy[sortedBusy.length - 1].end);
		if (lastMeetingEnd < businessEnd) {
			const duration = (businessEnd.getTime() - lastMeetingEnd.getTime()) / (1000 * 60 * 60);
			if (duration > 0) {
				freeSlots.push({
					start: sortedBusy[sortedBusy.length - 1].end,
					end: '5:00 PM',
					duration_hours: Math.round(duration * 10) / 10,
				});
			}
		}

		return freeSlots;
	}

	/**
	 * Calculate duration between two local time strings (like "9:00 AM" and "10:30 AM")
	 * Returns duration in hours
	 */
	private calculateDuration(start: string, end: string): number {
		try {
			// If these are UTC datetime strings, parse them directly
			if (start.includes('T') || start.includes('Z')) {
				const startDt = new Date(start);
				const endDt = new Date(end);
				return (endDt.getTime() - startDt.getTime()) / (1000 * 60 * 60);
			}
			
			// Otherwise, parse as local time strings
			const startDt = this.parseLocalTime(start);
			const endDt = this.parseLocalTime(end);
			return (endDt.getTime() - startDt.getTime()) / (1000 * 60 * 60);
		} catch (error) {
			console.error('Error calculating duration:', error);
			return 0;
		}
	}

	/**
	 * Process a natural language request using Cohere Command model
	 */
	async processRequest(userMessage: string): Promise<string> {
		try {
			console.log('Processing request:', userMessage);

			// Get tools for Cohere
			const tools = CohereService.createCalendarTools();
			console.log('Created tools:', tools.length);

			// Call Cohere with tools - pass chat history (without current user message, SDK will add it)
			const response = await this.cohereService.chat(
				userMessage,
				tools,
				this.chatHistory, // Pass existing history (without current user message)
				undefined // auto tool choice
			);
			
			console.log('Cohere response:', {
				hasText: !!response.text,
				hasToolCalls: !!response.tool_calls,
				toolCallsCount: response.tool_calls?.length || 0,
			});

			// Handle tool calls if any
			if (response.tool_calls && response.tool_calls.length > 0) {
				// Add user message to history (after calling chat, before processing tool calls)
				this.chatHistory.push({
					role: 'user',
					content: userMessage,
				});
				// Add assistant response with tool_calls to history
				const assistantMessage: ChatMessageV2 = {
					role: 'assistant',
				};
				
				if (response.text) {
					assistantMessage.content = response.text;
				}
				
				if (response.tool_calls && response.tool_calls.length > 0) {
					assistantMessage.toolCalls = response.tool_calls.map(tc => ({
						id: tc.id,
						type: 'function' as const,
						function: {
							name: tc.name,
							arguments: JSON.stringify(tc.parameters),
						},
					}));
				}
				
				// Ensure message has either content or toolCalls
				if (!assistantMessage.content && !assistantMessage.toolCalls) {
					assistantMessage.content = 'Processing request...';
				}
				
				this.chatHistory.push(assistantMessage);

				// Execute tools and collect results
				const toolResults: ChatMessageV2[] = [];

				for (const toolCall of response.tool_calls || []) {
					try {
						console.log(`Executing tool: ${toolCall.name}`, toolCall.parameters);
						const result = await this.callTool(toolCall.name, toolCall.parameters);
						console.log(`Tool ${toolCall.name} succeeded:`, result);
						const toolContent = JSON.stringify(result);
						if (toolContent && toolContent.trim()) {
							toolResults.push({
								role: 'tool',
								content: toolContent,
								toolCallId: toolCall.id,
							});
						}
					} catch (error: any) {
						console.error(`Tool ${toolCall.name} failed:`, {
							error: error.message,
							stack: error.stack,
							parameters: toolCall.parameters,
						});
						// Include full error details in tool result so Cohere can see what went wrong
						// Format it in a way Cohere can understand and potentially retry
						const errorContent = {
							success: false,
							error: error.message,
							tool: toolCall.name,
							suggestion: error.message.includes('not found') || error.message.includes('User') || error.message.includes('ambiguous')
								? 'Try using get_users_with_name_and_email tool first to find the correct user, then retry with the exact email address.'
								: error.message.includes('403') || error.message.includes('Forbidden') 
								? 'This operation requires application-level permissions or delegate access. The current user can only access their own calendar.'
								: error.message.includes('401') || error.message.includes('Unauthorized')
								? 'Authentication failed. Please sign out and sign in again.'
								: 'An error occurred while executing the tool. You may retry with corrected parameters.',
							retry_suggestion: error.message.includes('not found') || error.message.includes('ambiguous')
								? 'Call get_users_with_name_and_email to see all users, then retry with the correct email.'
								: undefined,
						};
						const errorToolContent = JSON.stringify(errorContent);
						if (errorToolContent && errorToolContent.trim()) {
							toolResults.push({
								role: 'tool',
								content: errorToolContent,
								toolCallId: toolCall.id,
							});
						}
					}
				}

				// Add tool results to chat history
				this.chatHistory.push(...toolResults);

				// Get final response from Cohere - respond naturally to the user's question using tool results
				console.log('Requesting final response from Cohere with chat history length:', this.chatHistory.length);
				const finalResponse = await this.cohereService.chat(
					'Based on the tool results above, provide a clear and direct answer to the user\'s question. ' +
					'If a tool failed (e.g., user not found), you can use get_users_with_name_and_email to find the correct user, then retry the original tool. ' +
					'Do not summarize actions taken, only provide the requested information.',
					tools,
					this.chatHistory,
					'NONE'
				);

				console.log('Final response from Cohere:', {
					hasText: !!finalResponse.text,
					textLength: finalResponse.text?.length || 0,
					textPreview: finalResponse.text?.substring(0, 100),
				});

				let responseText = finalResponse.text?.trim();
				
				if (!responseText || responseText.length === 0) {
					console.warn('Cohere returned empty response, generating fallback');
					// Generate a helpful response based on tool results
					const successfulTools = toolResults.filter(tr => {
						try {
							const content = typeof tr.content === 'string' ? JSON.parse(tr.content) : tr.content;
							return content && !content.error && content.success !== false;
						} catch {
							return true;
						}
					});
					
					if (successfulTools.length > 0) {
						responseText = 'I\'ve processed your request successfully. The information has been retrieved.';
					} else {
						responseText = 'I encountered an issue processing your request. Please try again or rephrase your question.';
					}
				}

				// Add final assistant response to chat history
				this.chatHistory.push({
					role: 'assistant',
					content: responseText,
				});

				setChatHistory(this.sessionId, this.chatHistory);

				return responseText;
			} else {
				this.chatHistory.push({
					role: 'user',
					content: userMessage,
				});
				const responseText = response.text?.trim() || 'I received your message. How can I help you?';
				
				this.chatHistory.push({
					role: 'assistant',
					content: responseText,
				});

				setChatHistory(this.sessionId, this.chatHistory);

				return responseText;
			}
		} catch (error: any) {
			throw new Error(`MCP processing error: ${error.message}`);
		}
	}

	/**
	 * Handle MCP request
	 */
	async handleRequest(request: MCPRequest): Promise<MCPResponse> {
		try {
			if (request.method === 'tools/list') {
				return {
					jsonrpc: '2.0',
					id: request.id,
					result: {
						tools: this.getTools(),
					},
				};
			}

			if (request.method === 'tools/call') {
				const params = (request as MCPToolsCallRequest).params;
				const result = await this.callTool(params.name, params.arguments || {});

				return {
					jsonrpc: '2.0',
					id: request.id,
					result: {
						content: [
							{
								type: 'text',
								text: JSON.stringify(result, null, 2),
							},
						],
					},
				};
			}

			if (request.method === 'chat') {
				const params = request.params as { message: string };
				const response = await this.processRequest(params.message);

				return {
					jsonrpc: '2.0',
					id: request.id,
					result: {
						content: [
							{
								type: 'text',
								text: response,
							},
						],
					},
				};
			}

			throw new Error(`Unknown method: ${request.method}`);
		} catch (error: any) {
			return {
				jsonrpc: '2.0',
				id: request.id,
				error: {
					code: -32603,
					message: error.message || 'Internal error',
				},
			};
		}
	}

	/**
	 * Clear chat history
	 */
	clearHistory(): void {
		this.chatHistory = [];
	}
}
