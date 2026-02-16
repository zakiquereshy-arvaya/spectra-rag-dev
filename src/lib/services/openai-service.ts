// OpenAI Service - Replacement for CohereService
// Uses GPT-4o-mini with function calling and streaming support

import OpenAI from 'openai';
import type {
	ChatCompletionMessageParam,
	ChatCompletionTool,
	ChatCompletionToolChoiceOption,
} from 'openai/resources/chat/completions';

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

// Message types for chat history (compatible with previous Cohere types)
// Uses unknown for content to accept various message formats from storage
export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content?: string | null | unknown;
	toolCalls?: Array<{
		id: string;
		type: 'function';
		function: {
			name: string;
			arguments: string;
		};
	}>;
	toolCallId?: string;
	toolResults?: Array<{ content?: string }>;
	_timestamp?: string;
}

// Tool definition type (OpenAI function format)
export interface ToolDefinition {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: {
			type: 'object';
			properties: Record<string, unknown>;
			required?: string[];
		};
	};
}

export class OpenAIService {
	private client: OpenAI;
	private model: string;

	constructor(apiKey: string, model: string = 'gpt-4o-mini') {
		this.client = new OpenAI({
			apiKey: apiKey,
		});
		this.model = model;
	}

	/**
	 * Helper to extract string content from various formats
	 */
	private extractContentString(content: unknown): string {
		if (content === null || content === undefined) {
			return '';
		}
		if (typeof content === 'string') {
			return content;
		}
		// Handle Cohere-style array content
		if (Array.isArray(content)) {
			return content
				.map((c) => {
					if (typeof c === 'string') return c;
					if (c && typeof c === 'object' && 'text' in c) return String(c.text);
					return '';
				})
				.filter(Boolean)
				.join('\n');
		}
		// Handle object with text property
		if (typeof content === 'object' && content !== null && 'text' in content) {
			return String((content as { text: unknown }).text);
		}
		return String(content);
	}

	/**
	 * Convert internal ChatMessage format to OpenAI message format.
	 * Also performs a final safety-net sanitization to ensure no orphaned tool messages.
	 */
	private convertToOpenAIMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
		const converted = messages.map((msg): ChatCompletionMessageParam => {
			const contentStr = this.extractContentString(msg.content);

			if (msg.role === 'system') {
				return {
					role: 'system',
					content: contentStr,
				};
			}

			if (msg.role === 'user') {
				return {
					role: 'user',
					content: contentStr,
				};
			}

			if (msg.role === 'assistant') {
				const assistantMsg: ChatCompletionMessageParam = {
					role: 'assistant',
					content: contentStr || null,
				};

				if (msg.toolCalls && msg.toolCalls.length > 0) {
					(assistantMsg as any).tool_calls = msg.toolCalls.map((tc) => ({
						id: tc.id,
						type: 'function' as const,
						function: {
							name: tc.function.name,
							arguments: tc.function.arguments,
						},
					}));
				}

				return assistantMsg;
			}

			if (msg.role === 'tool') {
				return {
					role: 'tool',
					content: contentStr,
					tool_call_id: msg.toolCallId || '',
				};
			}

			// Fallback
			return {
				role: 'user',
				content: contentStr,
			};
		});

		// Safety-net: ensure every 'tool' message follows an assistant message with tool_calls
		return this.sanitizeConvertedMessages(converted);
	}

	/**
	 * Final safety-net sanitization on converted OpenAI messages.
	 * Removes any 'tool' messages that don't follow an assistant message with tool_calls.
	 */
	private sanitizeConvertedMessages(messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] {
		const result: ChatCompletionMessageParam[] = [];

		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];

			if (msg.role === 'tool') {
				// Look back for a preceding assistant message with tool_calls
				let hasValidPredecessor = false;
				for (let j = result.length - 1; j >= 0; j--) {
					const prev = result[j];
					if (prev.role === 'tool') continue; // Skip past other tool messages in same group
					if (prev.role === 'assistant' && 'tool_calls' in prev && (prev as any).tool_calls?.length > 0) {
						hasValidPredecessor = true;
					}
					break;
				}

				if (!hasValidPredecessor) {
					console.warn(`[OpenAI] Dropping orphaned tool message at index ${i} (tool_call_id: ${(msg as any).tool_call_id || 'none'})`);
					continue;
				}
			}

			result.push(msg);
		}

		return result;
	}

	/**
	 * Convert internal tool definitions to OpenAI format
	 */
	private convertToOpenAITools(tools: ToolDefinition[]): ChatCompletionTool[] {
		return tools.map((tool) => ({
			type: 'function' as const,
			function: {
				name: tool.function.name,
				description: tool.function.description,
				parameters: tool.function.parameters as Record<string, unknown>,
			},
		}));
	}

	/**
	 * Build the messages array with optional system message for booking
	 */
	private buildMessages(message: string, chatHistory?: ChatMessage[]): ChatMessage[] {
		const messages: ChatMessage[] = [];

		// Add system message if this looks like a booking request
		if (
			message.toLowerCase().includes('book') ||
			message.toLowerCase().includes('schedule') ||
			message.toLowerCase().includes('create meeting')
		) {
			const todayEastern = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
			const currentYear = todayEastern.split('-')[0];
			messages.push({
				role: 'system',
				content:
					`You are a helpful calendar assistant. Today's date is ${todayEastern}. The current year is ${currentYear}. NEVER use dates from 2024 or 2025. When users ask to book, schedule, or create meetings, you MUST use the book_meeting tool. First call get_users_with_name_and_email to get the sender_email, then use book_meeting with all required parameters. You CAN and SHOULD book meetings when requested. If given a partial name like Ryan, Ashlee, David, etc. You must find the proper user and not pretend they dont exist. if its not recognized, identify the correct user`,
			});
		}

		messages.push(...(chatHistory || []), {
			role: 'user' as const,
			content: message,
		});

		return messages;
	}

	/**
	 * Extract response data from OpenAI message
	 */
	private extractResponse(choice: OpenAI.Chat.Completions.ChatCompletion.Choice): ChatResponse {
		const message = choice.message;
		const text = message.content || '';
		const toolCalls: ChatResponse['tool_calls'] = [];

		if (message.tool_calls && message.tool_calls.length > 0) {
			for (const toolCall of message.tool_calls) {
				// Handle OpenAI function tool calls
				const tc = toolCall as { id: string; type: string; function?: { name: string; arguments: string } };
				if (tc.type === 'function' && tc.function) {
					let parameters: Record<string, unknown> = {};
					if (tc.function.arguments) {
						try {
							parameters = JSON.parse(tc.function.arguments);
						} catch {
							parameters = {};
						}
					}
					toolCalls.push({
						id: tc.id || '',
						name: tc.function.name || '',
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
	 * Chat with OpenAI model (non-streaming)
	 */
	async chat(
		message: string,
		tools?: ToolDefinition[],
		chatHistory?: ChatMessage[],
		toolChoice?: 'required' | 'none' | undefined
	): Promise<ChatResponse> {
		try {
			const messages = this.buildMessages(message, chatHistory);
			const openaiMessages = this.convertToOpenAIMessages(messages);

			let openaiToolChoice: ChatCompletionToolChoiceOption | undefined;
			if (toolChoice === 'required') {
				openaiToolChoice = 'required';
			} else if (toolChoice === 'none') {
				openaiToolChoice = 'none';
			}

			const response = await this.client.chat.completions.create({
				model: this.model,
				messages: openaiMessages,
				tools: tools && tools.length > 0 ? this.convertToOpenAITools(tools) : undefined,
				tool_choice: tools && tools.length > 0 ? openaiToolChoice : undefined,
			});

			const choice = response.choices[0];
			if (!choice) {
				return { text: '' };
			}

			return this.extractResponse(choice);
		} catch (error: any) {
			console.error('OpenAI SDK error:', error);
			throw new Error(`OpenAI API error: ${error.message || 'Unknown error'}`);
		}
	}

	/**
	 * Chat with streaming response - yields chunks as they arrive
	 */
	async *chatStream(
		message: string,
		tools?: ToolDefinition[],
		chatHistory?: ChatMessage[],
		toolChoice?: 'required' | 'none' | undefined
	): AsyncGenerator<StreamChunk> {
		try {
			const messages = this.buildMessages(message, chatHistory);
			const openaiMessages = this.convertToOpenAIMessages(messages);

			let openaiToolChoice: ChatCompletionToolChoiceOption | undefined;
			if (toolChoice === 'required') {
				openaiToolChoice = 'required';
			} else if (toolChoice === 'none') {
				openaiToolChoice = 'none';
			}

			console.log('[OpenAI Stream] Starting stream with toolChoice:', toolChoice ?? 'auto');

			const stream = await this.client.chat.completions.create({
				model: this.model,
				messages: openaiMessages,
				tools: tools && tools.length > 0 ? this.convertToOpenAITools(tools) : undefined,
				tool_choice: tools && tools.length > 0 ? openaiToolChoice : undefined,
				stream: true,
			});

			// Track tool calls being built
			const toolCallsInProgress: Map<
				number,
				{
					id: string;
					name: string;
					arguments: string;
				}
			> = new Map();

			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta;
				const finishReason = chunk.choices[0]?.finish_reason;

				// Handle text content
				if (delta?.content) {
					console.log('[OpenAI Stream] Text chunk:', delta.content);
					yield {
						type: 'text',
						content: delta.content,
					};
				}

				// Handle tool calls
				if (delta?.tool_calls) {
					for (const toolCallDelta of delta.tool_calls) {
						const index = toolCallDelta.index;

						// Initialize tool call if this is the start
						if (toolCallDelta.id) {
							toolCallsInProgress.set(index, {
								id: toolCallDelta.id,
								name: toolCallDelta.function?.name || '',
								arguments: '',
							});
							console.log('[OpenAI Stream] Tool call start:', toolCallDelta.function?.name);
						}

						// Accumulate function name if provided
						if (toolCallDelta.function?.name) {
							const tc = toolCallsInProgress.get(index);
							if (tc && !tc.name) {
								tc.name = toolCallDelta.function.name;
							}
						}

						// Accumulate arguments
						if (toolCallDelta.function?.arguments) {
							const tc = toolCallsInProgress.get(index);
							if (tc) {
								tc.arguments += toolCallDelta.function.arguments;
							}
						}
					}
				}

				// Handle finish reason
				if (finishReason === 'tool_calls' || finishReason === 'stop') {
					// Yield all completed tool calls
					for (const [, toolCall] of toolCallsInProgress) {
						let parameters: Record<string, unknown> = {};
						try {
							if (toolCall.arguments) {
								parameters = JSON.parse(toolCall.arguments);
							}
						} catch {
							parameters = {};
						}

						console.log('[OpenAI Stream] Tool call end:', toolCall.name, parameters);
						yield {
							type: 'tool_call',
							toolCall: {
								id: toolCall.id,
								name: toolCall.name,
								parameters,
							},
						};
					}

					console.log('[OpenAI Stream] Stream complete, finish_reason:', finishReason);
					yield { type: 'done' };
				}
			}

			console.log('[OpenAI Stream] Finished iterating stream');
		} catch (error: any) {
			console.error('[OpenAI Stream] Error:', error);
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
	static createTimeEntryTools(): ToolDefinition[] {
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
	static createAllTools(): ToolDefinition[] {
		return [...this.createCalendarTools(), ...this.createTimeEntryTools()];
	}

	/**
	 * Create tool definitions for Microsoft Graph calendar operations
	 * Based on the Python FastMCP implementation
	 */
	static createCalendarTools(): ToolDefinition[] {
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
						'Check calendar availability for a user on a specific date. IMPORTANT: For best results, first call get_users_with_name_and_email to get the correct email address, then pass that email here. Returns busy times and free slots for the day. Free slots are derived from Microsoft Graph schedule data (getSchedule/freeBusy). All times are displayed in Eastern Time (EST/EDT).',
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
					name: 'get_free_slots',
					description:
						'Get free time slots for a user on a specific date using Microsoft Graph schedule data. Use this when the user asks "what times are free/available?" or wants specific availability windows. All times are in Eastern Time (EST/EDT).',
					parameters: {
						type: 'object',
						properties: {
							user_email: {
								type: 'string',
								description:
									'The email address or display name of the user to check. If a name is provided, it will be matched against users from get_users_with_name_and_email.',
							},
							date: {
								type: 'string',
								description:
									'The date to check. Supports natural language like "next monday", "tomorrow", "this friday", or date formats like "1/12/2026" or "2026-01-12". Defaults to today if not provided.',
							},
							duration_minutes: {
								type: 'number',
								description: 'Optional slot size in minutes (default: 30).',
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

// Re-export the ChatMessage type as the compatible type for external use
export type { ChatMessage as ChatMessageV2 };
