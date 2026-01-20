
import { CohereClientV2 } from 'cohere-ai';
import type { ChatMessageV2, ToolV2 } from 'cohere-ai/api';

export interface ChatResponse {
	text: string;
	tool_calls?: Array<{
		id: string;
		name: string;
		parameters: Record<string, unknown>;
	}>;
}

export interface StreamChunk {
	type: 'text' | 'tool_call' | 'done' | 'error';
	content?: string;
	toolCall?: {
		id: string;
		name: string;
		parameters: Record<string, unknown>;
	};
	error?: string;
}

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
	 * Build the messages array with optional system message
	 */
	private buildMessages(message: string, chatHistory?: ChatMessageV2[]): ChatMessageV2[] {
		const messages: ChatMessageV2[] = [];

		// Add system message if this looks like a booking request
		if (
			message.toLowerCase().includes('book') ||
			message.toLowerCase().includes('schedule') ||
			message.toLowerCase().includes('create meeting')
		) {
			messages.push({
				role: 'system',
				content:
					'You are a helpful calendar assistant. When users ask to book, schedule, or create meetings, you MUST use the book_meeting tool. First call get_users_with_name_and_email to get the sender_email, then use book_meeting with all required parameters. You CAN and SHOULD book meetings when requested.',
			});
		}

		messages.push(...(chatHistory || []), {
			role: 'user' as const,
			content: message,
		});

		return messages;
	}

	/**
	 * Extract response data from Cohere message
	 */
	private extractResponse(responseMessage: any): ChatResponse {
		let text = '';
		const toolCalls: ChatResponse['tool_calls'] = [];

		if (responseMessage) {
			// Handle content - can be string or array
			if (typeof responseMessage.content === 'string') {
				text = responseMessage.content;
			} else if (Array.isArray(responseMessage.content)) {
				text = responseMessage.content
					.filter((item: any) => item.type === 'text')
					.map((item: any) => item.text)
					.join('');
			}

			// Extract tool calls if present
			if (responseMessage.toolCalls && Array.isArray(responseMessage.toolCalls)) {
				for (const toolCall of responseMessage.toolCalls) {
					let parameters: Record<string, unknown> = {};
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
	}

	/**
	 * Chat with Cohere Command model using official SDK (non-streaming)
	 */
	async chat(
		message: string,
		tools?: ToolV2[],
		chatHistory?: ChatMessageV2[],
		toolChoice: 'REQUIRED' | 'NONE' | undefined = undefined
	): Promise<ChatResponse> {
		try {
			const messages = this.buildMessages(message, chatHistory);

			const response = await this.client.chat({
				model: this.model,
				messages: messages,
				tools: tools && tools.length > 0 ? tools : undefined,
				toolChoice: toolChoice,
			});

			return this.extractResponse(response.message);
		} catch (error: any) {
			console.error('Cohere SDK error:', error);
			throw new Error(`Cohere API error: ${error.message || 'Unknown error'}`);
		}
	}

	/**
	 * Chat with streaming response - yields chunks as they arrive
	 */
	async *chatStream(
		message: string,
		tools?: ToolV2[],
		chatHistory?: ChatMessageV2[],
		toolChoice: 'REQUIRED' | 'NONE' | undefined = undefined
	): AsyncGenerator<StreamChunk> {
		try {
			const messages = this.buildMessages(message, chatHistory);

			console.log('[Cohere Stream] Starting stream with toolChoice:', toolChoice);

			const stream = await this.client.chatStream({
				model: this.model,
				messages: messages,
				tools: tools && tools.length > 0 ? tools : undefined,
				toolChoice: toolChoice,
			});

			let currentToolCall: {
				id: string;
				name: string;
				arguments: string;
			} | null = null;

			for await (const event of stream) {
				console.log('[Cohere Stream] Event type:', event.type);
				
				// Handle different event types
				if (event.type === 'content-delta') {
					// Text content chunk
					const delta = event.delta as any;
					if (delta?.message?.content?.text) {
						console.log('[Cohere Stream] Text chunk:', delta.message.content.text);
						yield {
							type: 'text',
							content: delta.message.content.text,
						};
					}
				} else if (event.type === 'tool-call-start') {
					// Start of a tool call
					const delta = event.delta as any;
					if (delta?.message?.toolCalls) {
						const toolCall = delta.message.toolCalls;
						currentToolCall = {
							id: toolCall.id || '',
							name: toolCall.function?.name || '',
							arguments: '',
						};
						console.log('[Cohere Stream] Tool call start:', currentToolCall.name);
					}
				} else if (event.type === 'tool-call-delta') {
					const delta = event.delta as any;
					if (currentToolCall && delta?.message?.toolCalls?.function?.arguments) {
						currentToolCall.arguments += delta.message.toolCalls.function.arguments;
					}
				} else if (event.type === 'tool-call-end') {
					// End of tool call - parse and yield
					if (currentToolCall) {
						let parameters: Record<string, unknown> = {};
						try {
							if (currentToolCall.arguments) {
								parameters = JSON.parse(currentToolCall.arguments);
							}
						} catch {
							parameters = {};
						}
						console.log('[Cohere Stream] Tool call end:', currentToolCall.name, parameters);
						yield {
							type: 'tool_call',
							toolCall: {
								id: currentToolCall.id,
								name: currentToolCall.name,
								parameters,
							},
						};
						currentToolCall = null;
					}
				} else if (event.type === 'message-end') {
					// Stream complete
					console.log('[Cohere Stream] Stream complete');
					yield { type: 'done' };
				}
			}

			console.log('[Cohere Stream] Finished iterating stream');
		} catch (error: any) {
			console.error('[Cohere Stream] Error:', error);
			yield {
				type: 'error',
				error: error.message || 'Streaming error',
			};
		}
	}

	/**
	 * Create tool definitions for time entry/billing operations
	 * Used by the billing expert in MoE
	 */
	static createTimeEntryTools(): ToolV2[] {
		return [
			{
				type: 'function',
				function: {
					name: 'lookup_employee',
					description:
						'Look up an employee by name to get their QuickBooks ID. Use this before submitting time entries. Supports fuzzy matching.',
					parameters: {
						type: 'object',
						properties: {
							name: {
								type: 'string',
								description: 'The employee name to look up (partial matches supported)',
							},
						},
						required: ['name'],
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'lookup_customer',
					description:
						'Look up a customer/client by name to get their QuickBooks ID. Aliases like "ICE" for "Infrastructure Consulting & Engineering" are supported. Use this before submitting time entries.',
					parameters: {
						type: 'object',
						properties: {
							name: {
								type: 'string',
								description: 'The customer/client name to look up (partial matches and aliases supported)',
							},
						},
						required: ['name'],
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'list_employees',
					description:
						'Get a list of all employees with their names and QuickBooks IDs. Use this when the employee name is ambiguous or to see all available employees.',
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
					name: 'list_customers',
					description:
						'Get a list of all customers/clients with their names and QuickBooks IDs. Use this when the customer name is ambiguous or to see all available customers.',
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
					name: 'submit_time_entry',
					description:
						'Submit a time entry to QuickBooks and Monday.com. IMPORTANT: You must first use lookup_employee and lookup_customer to get the QBO IDs before submitting. All required fields must be filled.',
					parameters: {
						type: 'object',
						properties: {
							employee_name: {
								type: 'string',
								description: 'The display name of the employee',
							},
							employee_qbo_id: {
								type: 'string',
								description: 'The QuickBooks Online ID of the employee (from lookup_employee)',
							},
							customer_name: {
								type: 'string',
								description: 'The display name of the customer/client',
							},
							customer_qbo_id: {
								type: 'string',
								description: 'The QuickBooks Online ID of the customer (from lookup_customer)',
							},
							tasks_completed: {
								type: 'string',
								description: 'Description of the work/tasks completed',
							},
							hours: {
								type: 'number',
								description: 'Number of hours worked (decimal allowed, e.g., 1.5 for 1 hour 30 minutes)',
							},
							billable: {
								type: 'boolean',
								description: 'Whether the time is billable (default: true)',
							},
							entry_date: {
								type: 'string',
								description: 'Date of the time entry in YYYY-MM-DD format. Defaults to today if not provided.',
							},
						},
						required: [
							'employee_name',
							'employee_qbo_id',
							'customer_name',
							'customer_qbo_id',
							'tasks_completed',
							'hours',
						],
					},
				},
			},
		];
	}

	/**
	 * Create all tools (calendar + time entry) for unified expert
	 */
	static createAllTools(): ToolV2[] {
		return [...this.createCalendarTools(), ...this.createTimeEntryTools()];
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
					description:
						'Get a list of all users with their display names and email addresses. Use this first to find the correct email address before checking availability or booking meetings.',
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
					description:
						'Check calendar availability for a user on a specific date. IMPORTANT: For best results, first call get_users_with_name_and_email to get the correct email address, then pass that email here. Returns busy times and free slots for the day. All times are displayed in Eastern Time (EST/EDT).',
					parameters: {
						type: 'object',
						properties: {
							user_email: {
								type: 'string',
								description:
									'The email address or display name of the user to check availability for. If a name is provided, it will be matched against users from get_users_with_name_and_email.',
							},
							date: {
								type: 'string',
								description:
									'The date to check. Supports natural language like "next monday", "tomorrow", "this friday", or date formats like "1/12/2026" or "2026-01-12". Defaults to today if not provided.',
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
					description:
						"Book a meeting on a user's calendar. Use this tool when the user asks to book, schedule, or create a meeting. The sender (person booking) is automatically set to the logged-in user. IMPORTANT: If the user does not provide a subject, you MUST ask them \"What is the subject/title of this meeting?\" before calling this tool. If they want to invite additional attendees, ask for their email addresses. Creates a Teams meeting automatically. The recipient will receive a calendar invitation they can accept.",
					parameters: {
						type: 'object',
						properties: {
							user_email: {
								type: 'string',
								description:
									'The email address or display name of the user whose calendar to book on (the recipient). If a name is provided, it will be matched against users from get_users_with_name_and_email.',
							},
							subject: {
								type: 'string',
								description:
									'REQUIRED - The subject/title of the meeting. If the user has not provided this, you MUST ask them for it before calling this tool.',
							},
							start_datetime: {
								type: 'string',
								description:
									'Start time. Can be full datetime (YYYY-MM-DDTHH:MM:SS) or time only (e.g., "9:00 AM", "9 AM", "930"). If only time is provided, the date from the most recent availability check will be used, or today if no availability was checked.',
							},
							end_datetime: {
								type: 'string',
								description:
									'End time. Can be full datetime (YYYY-MM-DDTHH:MM:SS) or time only (e.g., "9:30 AM", "930 AM"). If only time is provided, the date from the most recent availability check will be used, or today if no availability was checked.',
							},
							attendees: {
								type: 'array',
								description:
									'Optional list of additional attendee email addresses to invite. If the user mentions other people to invite, ask for their email addresses.',
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
