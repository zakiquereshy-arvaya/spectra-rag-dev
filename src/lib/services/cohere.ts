// Cohere API Service using Official SDK

import { CohereClientV2 } from 'cohere-ai';
import type { ChatMessageV2, ToolV2 } from 'cohere-ai/api';

export class CohereService {
	private client: CohereClientV2;
	private model: string;

	constructor(apiKey: string, model: string = 'command-a-03-2025') {
		this.client = new CohereClientV2({
			token: apiKey,
		});
		this.model = model;
	}

	/**
	 * Chat with Cohere Command model using official SDK
	 */
	async chat(
		message: string,
		tools?: ToolV2[],
		chatHistory?: ChatMessageV2[],
		toolChoice: 'REQUIRED' | 'NONE' | undefined = undefined
	): Promise<{
		text: string;
		tool_calls?: Array<{
			id: string;
			name: string;
			parameters: Record<string, any>;
		}>;
	}> {
		try {
			// Build messages array - chatHistory contains previous messages, we add the current user message
			// Add system message to encourage tool use for booking meetings
			const messages: ChatMessageV2[] = [];
			
			// Add system message if this looks like a booking request
			if (message.toLowerCase().includes('book') || message.toLowerCase().includes('schedule') || message.toLowerCase().includes('create meeting')) {
				messages.push({
					role: 'system',
					content: 'You are a helpful calendar assistant. When users ask to book, schedule, or create meetings, you MUST use the book_meeting tool. First call get_users_with_name_and_email to get the sender_email, then use book_meeting with all required parameters. You CAN and SHOULD book meetings when requested.',
				});
			}
			
			messages.push(
				...(chatHistory || []),
				{
					role: 'user' as const,
					content: message,
				}
			);

			const response = await this.client.chat({
				model: this.model,
				messages: messages,
				tools: tools && tools.length > 0 ? tools : undefined,
				toolChoice: toolChoice,
			});

			// Extract text from response
			let text = '';
			const toolCalls: Array<{ id: string; name: string; parameters: Record<string, any> }> = [];

			// Cohere SDK returns response.message with content and toolCalls
			if (response.message) {
				// Handle content - can be string or array
				if (typeof response.message.content === 'string') {
					text = response.message.content;
				} else if (Array.isArray(response.message.content)) {
					// Extract text from content array
					text = response.message.content
						.filter((item: any) => item.type === 'text')
						.map((item: any) => item.text)
						.join('');
				}
				
				// Extract tool calls if present
				if (response.message.toolCalls && Array.isArray(response.message.toolCalls)) {
					for (const toolCall of response.message.toolCalls) {
						let parameters: Record<string, any> = {};
						if (toolCall.function?.arguments) {
							try {
								parameters = JSON.parse(toolCall.function.arguments);
							} catch {
								parameters = {};
							}
						}
						toolCalls.push({
							id: toolCall.id || '',
							name: toolCall.function?.name || '',
							parameters,
						});
					}
				}
			}

			return {
				text,
				tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
			};
		} catch (error: any) {
			console.error('Cohere SDK error:', error);
			throw new Error(`Cohere API error: ${error.message || 'Unknown error'}`);
		}
	}

	/**
	 * Create tool definitions for Microsoft Graph calendar operations
	 * Based on the Python FastMCP implementation
	 */
	static createCalendarTools(): ToolV2[] {
		return [
			{
				type: 'function',
				function: {
					name: 'get_users_with_name_and_email',
					description: 'Get a list of all users with their display names and email addresses. Use this first to find the correct email address before checking availability or booking meetings.',
					parameters: {
						type: 'object',
						properties: {},
						required: [],
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'check_availability',
					description: 'Check calendar availability for a user on a specific date. IMPORTANT: For best results, first call get_users_with_name_and_email to get the correct email address, then pass that email here. Returns busy times and free slots for the day. All times are displayed in Eastern Time (EST/EDT).',
					parameters: {
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
			},
			{
				type: 'function',
				function: {
				name: 'book_meeting',
				description: 'Book a meeting on a user\'s calendar. Use this tool when the user asks to book, schedule, or create a meeting. IMPORTANT: sender_email MUST be provided - call get_users_with_name_and_email first to get it. Creates a Teams meeting automatically. You CAN and SHOULD use this tool when users request to book meetings.',
					parameters: {
						type: 'object',
						properties: {
							user_email: {
								type: 'string',
								description: 'The email address or display name of the user whose calendar to book on. If a name is provided, it will be matched against users from get_users_with_name_and_email.',
							},
							subject: {
								type: 'string',
								description: 'The subject/title of the meeting',
							},
							start_datetime: {
								type: 'string',
								description: 'Start time. Can be full datetime (YYYY-MM-DDTHH:MM:SS) or time only (e.g., "9:00 AM", "9 AM", "14:00"). If only time is provided, today\'s date will be used.',
							},
							end_datetime: {
								type: 'string',
								description: 'End time. Can be full datetime (YYYY-MM-DDTHH:MM:SS) or time only (e.g., "9:30 AM", "9:30 AM", "14:30"). If only time is provided, today\'s date will be used.',
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
								items: {
									type: 'string',
								},
							},
							body: {
								type: 'string',
								description: 'Optional meeting body/description',
							},
						},
						required: ['user_email', 'subject', 'start_datetime', 'end_datetime', 'sender_name', 'sender_email'],
					},
				},
			},
		];
	}
}
