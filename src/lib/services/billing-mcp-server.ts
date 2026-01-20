// Billing MCP Server - Time Entry Expert for MoE
// Handles time entry tools: lookup_employee, lookup_customer, list_employees, list_customers, submit_time_entry

import type { ChatMessageV2 } from 'cohere-ai/api';
import { CohereService } from './cohere';
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
import { BILLI_DEV_WEBHOOK_URL } from '$env/static/private';

// Extended message type with timestamp for storage
type StoredChatMessage = ChatMessageV2 & { _timestamp?: string };

export interface BillingMCPRequest {
	message: string;
	sessionId: string;
}

export class BillingMCPServer {
	private cohereService: CohereService;
	private sessionId: string;
	private chatHistory: StoredChatMessage[] = [];
	private loggedInUser: { name: string; email: string } | null = null;
	private lastTimestamp: number = 0;
	private historyLoaded: boolean = false;
	private webhookUrl: string;

	// Cache for employees and customers
	private cachedEmployees: Employee[] | null = null;
	private cachedCustomers: Customer[] | null = null;

	constructor(
		cohereApiKey: string,
		sessionId: string,
		loggedInUser?: { name: string; email: string },
		webhookUrl?: string
	) {
		this.cohereService = new CohereService(cohereApiKey);
		this.sessionId = sessionId;
		this.loggedInUser = loggedInUser || null;
		this.webhookUrl = webhookUrl || BILLI_DEV_WEBHOOK_URL;
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

	/**
	 * Get cached employees
	 */
	private async getCachedEmployees(): Promise<Employee[]> {
		if (this.cachedEmployees === null) {
			this.cachedEmployees = await getAllEmployees();
		}
		return this.cachedEmployees;
	}

	/**
	 * Get cached customers
	 */
	private async getCachedCustomers(): Promise<Customer[]> {
		if (this.cachedCustomers === null) {
			this.cachedCustomers = await getAllCustomers();
		}
		return this.cachedCustomers;
	}

	/**
	 * Execute a billing tool
	 */
	async callTool(name: string, args: Record<string, any>): Promise<any> {
		try {
			switch (name) {
				case 'lookup_employee': {
					const { name: employeeName } = args;
					if (!employeeName) {
						throw new Error('Employee name is required');
					}

					const employee = await getEmployeeByName(employeeName);
					if (!employee) {
						const allEmployees = await this.getCachedEmployees();
						const suggestions = allEmployees.slice(0, 5).map((e) => e.name);
						return {
							found: false,
							error: `Employee "${employeeName}" not found`,
							suggestions: suggestions,
							hint: 'Try using list_employees to see all available employees',
						};
					}

					return {
						found: true,
						employee: {
							name: employee.name,
							email: employee.email,
							qbo_id: employee.qbo_id,
						},
					};
				}

				case 'lookup_customer': {
					const { name: customerName } = args;
					if (!customerName) {
						throw new Error('Customer name is required');
					}

					const customer = await getCustomerByName(customerName);
					if (!customer) {
						const allCustomers = await this.getCachedCustomers();
						const suggestions = allCustomers.slice(0, 5).map((c) => c.name);
						return {
							found: false,
							error: `Customer "${customerName}" not found`,
							suggestions: suggestions,
							hint: 'Try using list_customers to see all available customers',
						};
					}

					return {
						found: true,
						customer: {
							name: customer.name,
							qbo_id: customer.qbo_id,
						},
					};
				}

				case 'list_employees': {
					const employees = await this.getCachedEmployees();
					return {
						employees: employees.map((e) => ({
							name: e.name,
							email: e.email,
							qbo_id: e.qbo_id,
						})),
						total: employees.length,
					};
				}

				case 'list_customers': {
					const customers = await this.getCachedCustomers();
					return {
						customers: customers.map((c) => ({
							name: c.name,
							qbo_id: c.qbo_id,
						})),
						total: customers.length,
					};
				}

				case 'submit_time_entry': {
					const {
						employee_name,
						employee_qbo_id,
						customer_name,
						customer_qbo_id,
						tasks_completed,
						hours,
						billable = true,
						entry_date,
					} = args;

					// Validate required fields
					if (!employee_name || !employee_qbo_id) {
						throw new Error(
							'Employee name and QBO ID are required. Use lookup_employee first to get these values.'
						);
					}
					if (!customer_name || !customer_qbo_id) {
						throw new Error(
							'Customer name and QBO ID are required. Use lookup_customer first to get these values.'
						);
					}
					if (!tasks_completed) {
						throw new Error('Tasks completed description is required');
					}
					if (hours === undefined || hours <= 0) {
						throw new Error('Hours must be a positive number');
					}

					// Build time entry payload
					const timeEntry = {
						employee_name,
						employee_qbo_id,
						customer_name,
						customer_qbo_id,
						tasks_completed,
						hours: parseFloat(hours),
						billable: billable !== false,
						entry_date: entry_date || new Date().toISOString().split('T')[0],
						submitted_by: this.loggedInUser?.name || 'Unknown User',
						submitted_at: new Date().toISOString(),
					};

					// Send to n8n webhook
					const response = await fetch(this.webhookUrl, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ timeEntry }),
					});

					if (!response.ok) {
						const errorText = await response.text();
						throw new Error(`Failed to submit time entry: ${response.statusText}. ${errorText}`);
					}

					// Parse response if available
					let webhookResult = null;
					const responseText = await response.text();
					if (responseText && responseText.trim()) {
						try {
							webhookResult = JSON.parse(responseText);
						} catch {
							// Non-JSON response is OK
						}
					}

					return {
						success: true,
						message: 'Time entry submitted successfully',
						timeEntry,
						webhookResult,
					};
				}

				default:
					throw new Error(`Unknown billing tool: ${name}`);
			}
		} catch (error: any) {
			console.error(`[BillingMCP] Tool execution error for ${name}:`, error);
			throw new Error(`Tool execution error: ${error.message}`);
		}
	}

	/**
	 * Handle streaming request
	 */
	async *handleRequestStream(request: BillingMCPRequest): AsyncGenerator<string> {
		const { message: userMessage, sessionId } = request;

		if (!userMessage) {
			yield JSON.stringify({ error: 'Message is required' });
			return;
		}

		try {
			await this.loadHistory();

			const tools = CohereService.createTimeEntryTools();
			const preparedHistory = prepareChatHistory(this.chatHistory);

			// Add system context for billing
			const systemMessage: ChatMessageV2 = {
				role: 'system',
				content: `You are Billi, a time entry assistant for Arvaya. You MUST USE your tools to complete tasks - never just describe them.

**CRITICAL - YOU ARE AN AGENT:**
- When users want to log time, IMMEDIATELY call lookup_employee and lookup_customer
- DO NOT say "I will use..." - just USE the tools directly
- Execute the full workflow autonomously: lookup -> lookup -> submit
- Act, don't instruct

**Your Tools:**
- lookup_employee: Call this to find employee QBO ID
- lookup_customer: Call this to find customer QBO ID
- list_employees: Call this if employee name is ambiguous
- list_customers: Call this if customer name is ambiguous
- submit_time_entry: Call this after lookups complete

**Workflow:**
1. User says "log 2 hours for ICE" → you call lookup_employee AND lookup_customer
2. Get the QBO IDs from results
3. Call submit_time_entry with all details
4. Confirm success (show names only, NEVER show QBO IDs)

**Context:**
- Logged-in user: ${this.loggedInUser?.name || 'Unknown'} (${this.loggedInUser?.email || 'no email'})
- If no employee mentioned, assume logged-in user is the employee
- NEVER show QBO IDs in your responses to users`,
			};

			// IMPORTANT: Buffer ALL initial response - don't yield text until we know if there are tool calls
			let fullText = '';
			const toolCalls: any[] = [];

			// First Cohere call with tools - collect ENTIRE response without yielding
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

			// Add user message to history
			this.pushToHistory({
				role: 'user',
				content: userMessage,
			});

			// Handle tool calls if any
			if (toolCalls.length > 0) {
				// Tool calls present - DON'T show the buffered text, just process tools silently

				// Add assistant message with tool_calls to history
				const assistantMessage: ChatMessageV2 = {
					role: 'assistant',
				};

				if (fullText) {
					assistantMessage.content = fullText;
				}

				assistantMessage.toolCalls = toolCalls.map((tc) => ({
					id: tc.id,
					type: 'function' as const,
					function: {
						name: tc.name,
						arguments: JSON.stringify(tc.parameters),
					},
				}));

				if (!assistantMessage.content && !assistantMessage.toolCalls) {
					assistantMessage.content = 'Processing your request...';
				}

				this.pushToHistory(assistantMessage);

				// Execute tools
				const toolResults: ChatMessageV2[] = [];
				for (const toolCall of toolCalls) {
					try {
						console.log(`[BillingMCP] Executing tool: ${toolCall.name}`, toolCall.parameters);
						const result = await this.callTool(toolCall.name, toolCall.parameters);
						console.log(`[BillingMCP] Tool ${toolCall.name} succeeded`);
						toolResults.push({
							role: 'tool',
							content: JSON.stringify(result),
							toolCallId: toolCall.id,
						});
					} catch (error: any) {
						console.error(`[BillingMCP] Tool ${toolCall.name} failed:`, error);
						toolResults.push({
							role: 'tool',
							content: JSON.stringify({
								success: false,
								error: error.message,
								tool: toolCall.name,
							}),
							toolCallId: toolCall.id,
						});
					}
				}

				this.pushToHistory(...toolResults);

				// Get final response
				const preparedHistoryForFinal = prepareChatHistory(this.chatHistory);
				let finalFullText = '';

				for await (const chunk of this.cohereService.chatStream(
					'Based on the tool results, provide a clear response to the user. If a time entry was submitted successfully, confirm the details. If there were errors, explain what went wrong and how to fix it.',
					tools,
					[systemMessage, ...preparedHistoryForFinal],
					'NONE'
				)) {
					if (chunk.type === 'text' && chunk.content) {
						finalFullText += chunk.content;
						yield chunk.content;
					} else if (chunk.type === 'error') {
						yield '\n\n[Error: ' + chunk.error + ']';
					}
				}

				const finalResponse = finalFullText || 'Time entry processed.';
				this.pushToHistory({
					role: 'assistant',
					content: finalResponse,
				});
			} else {
				// No tool calls - yield the buffered text to the user
				const responseText = fullText || 'I can help you log time entries. Please tell me the employee, customer, hours, and tasks completed.';
				yield responseText;
				this.pushToHistory({
					role: 'assistant',
					content: responseText,
				});
			}

			await this.saveHistory();
		} catch (error: any) {
			console.error('[BillingMCP] Stream error:', error);
			yield '\n\n[Error: ' + error.message + ']';
		}
	}

	/**
	 * Clear chat history
	 */
	clearHistory(): void {
		this.chatHistory = [];
		this.historyLoaded = false;
	}
}
