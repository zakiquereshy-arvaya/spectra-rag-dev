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
	 * Embed text using Cohere's embed API
	 */
	async embed(
		texts: string[],
		model: string = 'embed-english-v3.0',
		inputType: 'search_query' | 'search_document' = 'search_query'
	): Promise<number[][]> {
		try {
			const response = await this.client.embed({
				texts: texts,
				model: model,
				inputType: inputType,
			});

			return response.embeddings;
		} catch (error: any) {
			console.error('Cohere embed error:', error);
			throw new Error(`Cohere embed API error: ${error.message || 'Unknown error'}`);
		}
	}

	/**
	 * Chat with Cohere Command model using official SDK
	 */
	async chat(
		message: string,
		tools?: ToolV2[],
		chatHistory?: ChatMessageV2[],
		toolChoice: 'REQUIRED' | 'NONE' | undefined = undefined,
		documents?: Array<{ content: string; metadata?: Record<string, any> }>
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
			const messages = [
				...(chatHistory || []),
				{
					role: 'user' as const,
					content: message,
				},
			];

			// Format documents for Cohere API if provided
			const cohereDocuments = documents?.map(doc => ({
				data: {
					content: doc.content,
					snippet: doc.content.substring(0, 200), // Cohere expects snippet
					...(doc.metadata || {}),
				},
			}));

			const response = await this.client.chat({
				model: this.model,
				messages: messages,
				tools: tools && tools.length > 0 ? tools : undefined,
				toolChoice: toolChoice,
				documents: cohereDocuments && cohereDocuments.length > 0 ? cohereDocuments : undefined,
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
					description: 'Check calendar availability for a user on a specific date. IMPORTANT: For best results, first call get_users_with_name_and_email to get the correct email address, then pass that email here. Returns busy times and free slots for the day.',
					parameters: {
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
			},
			{
				type: 'function',
				function: {
					name: 'book_meeting',
					description: 'Book a meeting on a user\'s calendar. IMPORTANT: sender_email MUST be provided - call get_users_with_name_and_email first to get it. Creates a Teams meeting automatically.',
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
