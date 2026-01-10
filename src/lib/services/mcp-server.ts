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
import type { ChatMessageV2 } from 'cohere-ai/api';
import { getChatHistory, setChatHistory } from './chat-history-store';

export class MCPServer {
	private graphService: MicrosoftGraphService;
	private cohereService: CohereService;
	private sessionId: string;
	private chatHistory: ChatMessageV2[] = [];

	constructor(
		cohereApiKey: string,
		sessionId: string,
		authService?: MicrosoftGraphAuth,
		accessToken?: string
	) {
		// Use app-only auth (client credentials) if available, otherwise fallback to delegated token
		this.graphService = new MicrosoftGraphService(accessToken, authService);
		this.cohereService = new CohereService(cohereApiKey);
		this.sessionId = sessionId;
		// Load existing chat history for this session
		this.chatHistory = getChatHistory(sessionId);
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
				description: 'Check calendar availability for a user on a specific date. IMPORTANT: For best results, first call get_users_with_name_and_email to get the correct email address, then pass that email here. Returns busy times and free slots for the day.',
				inputSchema: {
					type: 'object',
					properties: {
						user_email: {
							type: 'string',
							description: 'The email address or display name of the user to check availability for. If a name is provided, it will be matched against users from get_users_with_name_and_email.',
						},
						date: {
							type: 'string',
							description: 'The date to check in YYYY-MM-DD format. Defaults to today if not provided.',
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
					
					// If user_email is a name (doesn't contain @), try to match it
					if (!userEmail.includes('@')) {
						const users = await this.graphService.listUsers();
						const nameLower = userEmail.toLowerCase();
						
						// Try exact match first
						let matchedUser = users.value.find(
							(u) => u.displayName.toLowerCase() === nameLower
						);
						
						// Try partial match
						if (!matchedUser) {
							matchedUser = users.value.find(
								(u) => u.displayName.toLowerCase().includes(nameLower) || 
								       nameLower.includes(u.displayName.toLowerCase())
							);
						}
						
						if (!matchedUser) {
							const availableNames = users.value.slice(0, 5).map(u => u.displayName);
							throw new Error(
								`User '${userEmail}' not found or ambiguous. ` +
								`Please use get_users_with_name_and_email tool first to get the correct email address. ` +
								`Example names found: ${availableNames.join(', ')}`
							);
						}
						
						userEmail = matchedUser.mail || matchedUser.userPrincipalName;
					}
					
					// Default to today if no date provided
					if (!date || date === '') {
						const today = new Date();
						date = today.toISOString().split('T')[0];
					}

					// Parse date and create datetime range for the full day
					const dateObj = new Date(date + 'T00:00:00');
					const startDateTime = `${date}T04:00:00Z`; // Start of day EST in UTC
					const nextDay = new Date(dateObj);
					nextDay.setDate(nextDay.getDate() + 1);
					const nextDayStr = nextDay.toISOString().split('T')[0];
					const endDateTime = `${nextDayStr}T05:00:00Z`; // Start of next day EST in UTC

					// Get calendar view for the user
					const events = await this.graphService.getUserCalendarView(
						userEmail,
						startDateTime,
						endDateTime
					);

					// Extract busy times
					const busyTimes = events.value
						.filter((event) => !event.isAllDay)
						.map((event) => ({
							subject: event.subject,
							start: event.start.dateTime,
							end: event.end.dateTime,
						}));

					// Calculate free slots (9am-5pm business hours)
					const freeSlots = this.calculateFreeSlots(busyTimes, date);

					const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' });

					return {
						user_email: userEmail,
						date,
						day_of_week: dayOfWeek,
						busy_times: busyTimes,
						total_events: busyTimes.length,
						free_slots: freeSlots,
						is_completely_free: busyTimes.length === 0,
					};
				}

				case 'book_meeting': {
					let {
						user_email,
						subject,
						start_datetime,
						end_datetime,
						sender_name,
						sender_email,
						attendees,
						body,
					} = args;

					if (!sender_email || !sender_email.trim()) {
						throw new Error(
							'sender_email is REQUIRED. Please call get_users_with_name_and_email first to get the sender\'s email address.'
						);
					}

					// If user_email is a name (doesn't contain @), try to match it
					if (!user_email.includes('@')) {
						const users = await this.graphService.listUsers();
						const nameLower = user_email.toLowerCase();
						
						// Try exact match first
						let matchedUser = users.value.find(
							(u) => u.displayName.toLowerCase() === nameLower
						);
						
						// Try partial match
						if (!matchedUser) {
							matchedUser = users.value.find(
								(u) => u.displayName.toLowerCase().includes(nameLower) || 
								       nameLower.includes(u.displayName.toLowerCase())
							);
						}
						
						if (!matchedUser) {
							const availableNames = users.value.slice(0, 5).map(u => u.displayName);
							throw new Error(
								`User '${user_email}' not found or ambiguous. ` +
								`Please use get_users_with_name_and_email tool first to get the correct email address. ` +
								`Example names found: ${availableNames.join(', ')}`
							);
						}
						
						user_email = matchedUser.mail || matchedUser.userPrincipalName;
					}

					// Validate datetime format
					const startDt = new Date(start_datetime);
					const endDt = new Date(end_datetime);
					
					if (isNaN(startDt.getTime()) || isNaN(endDt.getTime())) {
						throw new Error('Invalid datetime format. Use YYYY-MM-DDTHH:MM:SS');
					}

					if (endDt <= startDt) {
						throw new Error('End time must be after start time');
					}

					const event = await this.graphService.createEventForUser(user_email, {
						subject,
						start: start_datetime,
						end: end_datetime,
						timeZone: 'Eastern Standard Time',
						senderName: sender_name,
						senderEmail: sender_email,
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
							sender_name: sender_name,
							sender_email: sender_email,
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
	 */
	private calculateFreeSlots(busyTimes: Array<{ start: string; end: string }>, date: string): Array<{ start: string; end: string; duration_hours: number }> {
		if (busyTimes.length === 0) {
			return [{
				start: `${date}T09:00:00`,
				end: `${date}T17:00:00`,
				duration_hours: 8,
			}];
		}

		const sortedBusy = [...busyTimes].sort((a, b) => 
			new Date(a.start).getTime() - new Date(b.start).getTime()
		);

		const freeSlots: Array<{ start: string; end: string; duration_hours: number }> = [];
		const businessStart = `${date}T09:00:00`;
		const businessEnd = `${date}T17:00:00`;

		// Check if there's free time before first meeting
		const firstMeetingStart = sortedBusy[0].start.split('T')[1]?.split('.')[0];
		if (firstMeetingStart && firstMeetingStart > '09:00:00') {
			const duration = this.calculateDuration(businessStart, sortedBusy[0].start);
			if (duration > 0) {
				freeSlots.push({
					start: businessStart,
					end: sortedBusy[0].start,
					duration_hours: duration,
				});
			}
		}

		// Check gaps between meetings
		for (let i = 0; i < sortedBusy.length - 1; i++) {
			const currentEnd = sortedBusy[i].end;
			const nextStart = sortedBusy[i + 1].start;
			if (new Date(currentEnd) < new Date(nextStart)) {
				const duration = this.calculateDuration(currentEnd, nextStart);
				if (duration > 0) {
					freeSlots.push({
						start: currentEnd,
						end: nextStart,
						duration_hours: duration,
					});
				}
			}
		}

		// Check if there's free time after last meeting
		const lastMeetingEnd = sortedBusy[sortedBusy.length - 1].end.split('T')[1]?.split('.')[0];
		if (lastMeetingEnd && lastMeetingEnd < '17:00:00') {
			const duration = this.calculateDuration(sortedBusy[sortedBusy.length - 1].end, businessEnd);
			if (duration > 0) {
				freeSlots.push({
					start: sortedBusy[sortedBusy.length - 1].end,
					end: businessEnd,
					duration_hours: duration,
				});
			}
		}

		return freeSlots;
	}

	/**
	 * Calculate duration in hours between two datetime strings
	 */
	private calculateDuration(start: string, end: string): number {
		try {
			const startClean = start.replace('Z', '').split('+')[0].split('.')[0];
			const endClean = end.replace('Z', '').split('+')[0].split('.')[0];
			const startDt = new Date(startClean);
			const endDt = new Date(endClean);
			const duration = (endDt.getTime() - startDt.getTime()) / (1000 * 60 * 60);
			return Math.round(duration * 100) / 100;
		} catch {
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
				this.chatHistory.push({
					role: 'assistant',
					content: response.text || '',
					toolCalls: response.tool_calls?.map(tc => ({
						id: tc.id,
						type: 'function' as const,
						function: {
							name: tc.name,
							arguments: JSON.stringify(tc.parameters),
						},
					})) || [],
				});

				// Execute tools and collect results
				const toolResults: ChatMessageV2[] = [];

				for (const toolCall of response.tool_calls || []) {
					try {
						console.log(`Executing tool: ${toolCall.name}`, toolCall.parameters);
						const result = await this.callTool(toolCall.name, toolCall.parameters);
						console.log(`Tool ${toolCall.name} succeeded:`, result);
						toolResults.push({
							role: 'tool',
							content: JSON.stringify(result),
							toolCallId: toolCall.id,
						});
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
							suggestion: error.message.includes('403') || error.message.includes('Forbidden') 
								? 'This operation requires application-level permissions or delegate access. The current user can only access their own calendar.'
								: error.message.includes('401') || error.message.includes('Unauthorized')
								? 'Authentication failed. Please sign out and sign in again.'
								: 'An error occurred while executing the tool.',
						};
						toolResults.push({
							role: 'tool',
							content: JSON.stringify(errorContent),
							toolCallId: toolCall.id,
						});
					}
				}

				// Add tool results to chat history
				this.chatHistory.push(...toolResults);

				// Get final response from Cohere - respond naturally to the user's question using tool results
				// Don't ask for summaries, just answer the question directly
				const finalResponse = await this.cohereService.chat(
					'Based on the tool results above, provide a clear and direct answer to the user\'s question. Do not summarize actions taken, only provide the requested information.',
					tools,
					this.chatHistory, // Includes user message, assistant tool calls, and tool results
					'NONE' // Don't use tools again, just respond
				);

				// Add final assistant response to chat history
				this.chatHistory.push({
					role: 'assistant',
					content: finalResponse.text,
				});

				// Persist chat history
				setChatHistory(this.sessionId, this.chatHistory);

				return finalResponse.text;
			} else {
				// No tool calls, add messages to history and return
				this.chatHistory.push({
					role: 'user',
					content: userMessage,
				});
				this.chatHistory.push({
					role: 'assistant',
					content: response.text,
				});

				// Persist chat history
				setChatHistory(this.sessionId, this.chatHistory);

				return response.text;
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
