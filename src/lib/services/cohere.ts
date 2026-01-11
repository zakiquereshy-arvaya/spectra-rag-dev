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
				description: 'Book a meeting on a user\'s calendar. Use this tool when the user asks to book, schedule, or create a meeting. The sender (person booking) is automatically set to the logged-in user. IMPORTANT: If the user does not provide a subject, you MUST ask them "What is the subject/title of this meeting?" before calling this tool. If they want to invite additional attendees, ask for their email addresses. Creates a Teams meeting automatically. The recipient will receive a calendar invitation they can accept.',
					parameters: {
						type: 'object',
						properties: {
							user_email: {
								type: 'string',
								description: 'The email address or display name of the user whose calendar to book on (the recipient). If a name is provided, it will be matched against users from get_users_with_name_and_email.',
							},
							subject: {
								type: 'string',
								description: 'REQUIRED - The subject/title of the meeting. If the user has not provided this, you MUST ask them for it before calling this tool.',
							},
							start_datetime: {
								type: 'string',
								description: 'Start time. Can be full datetime (YYYY-MM-DDTHH:MM:SS) or time only (e.g., "9:00 AM", "9 AM", "930"). If only time is provided, the date from the most recent availability check will be used, or today if no availability was checked.',
							},
							end_datetime: {
								type: 'string',
								description: 'End time. Can be full datetime (YYYY-MM-DDTHH:MM:SS) or time only (e.g., "9:30 AM", "930 AM"). If only time is provided, the date from the most recent availability check will be used, or today if no availability was checked.',
							},
							attendees: {
								type: 'array',
								description: 'Optional list of additional attendee email addresses to invite. If the user mentions other people to invite, ask for their email addresses.',
								items: {
									type: 'string',
								},
							},
							body: {
								type: 'string',
								description: 'Optional meeting body/description',
							},
						},
						required: ['user_email', 'subject', 'start_datetime', 'end_datetime'],
					},
				},
			},
		];
	}
}
