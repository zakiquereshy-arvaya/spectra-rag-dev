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
						throw new Error('STOP. You must call lookup_employee first to get the real QBO ID.');
					}
					if (!customer_name || !customer_qbo_id) {
						throw new Error('STOP. You must call lookup_customer first to get the real QBO ID.');
					}

					// REJECT FAKE/PLACEHOLDER IDs - must be real from database lookups
					const fakeIdPatterns = /^(EMP|CUST|ID|QBO|TEST|PLACEHOLDER|XXX|000)/i;
					if (fakeIdPatterns.test(employee_qbo_id) || employee_qbo_id.length < 3) {
						throw new Error(`INVALID employee_qbo_id "${employee_qbo_id}". Call lookup_employee("${employee_name}") to get the real ID.`);
					}
					if (fakeIdPatterns.test(customer_qbo_id) || customer_qbo_id.length < 3) {
						throw new Error(`INVALID customer_qbo_id "${customer_qbo_id}". Call lookup_customer("${customer_name}") to get the real ID.`);
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

			// Get current date info for the AI
			const now = new Date();
			const todayStr = now.toISOString().split('T')[0];
			const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
			const formattedDate = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

			// Add system context for billing
			const systemMessage: ChatMessageV2 = {
				role: 'system',
				content: `You are Billi, an AI assistant for Arvaya time tracking.

**CURRENT DATE: ${dayOfWeek}, ${formattedDate} (${todayStr})**
- "today" = ${todayStr}
- "yesterday" = ${new Date(now.getTime() - 86400000).toISOString().split('T')[0]}

**LOGGED-IN USER: ${this.loggedInUser?.name || 'Unknown'} (${this.loggedInUser?.email || 'no email'})**

**WHAT YOU TELL USERS:**
- You can log time entries - just need the customer (Arvaya, ICE, etc), hours, and what they worked on
- That's it. Keep it simple.

**INTERNAL WORKFLOW (never explain this to users):**
1. User: "log 2 hours for ICE - worked on migration"
2. You silently call lookup_employee("${this.loggedInUser?.name || ''}")
3. You silently call lookup_customer("ICE")
4. You silently call submit_time_entry with entry_date="${todayStr}" (or the date user specified in YYYY-MM-DD)
5. You respond: "Logged 2 hours for Infrastructure Consulting & Engineering: worked on migration"

**RULES:**
- The logged-in user IS the employee - NEVER ask who they are
- "Arvaya" and "ICE" are customer names
- When user says "today", use entry_date="${todayStr}"
- NEVER mention: QuickBooks, QBO, IDs, lookups, internal tools
- Just do the work silently and confirm when done`,
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
				console.log(`[BillingMCP] Agentic loop iteration ${iteration}`);

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

				// No tool calls = done, yield final response
				if (toolCalls.length === 0) {
					const responseText = fullText || 'How can I help you with time tracking?';
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
						console.log(`[BillingMCP] Executing tool: ${toolCall.name}`, toolCall.parameters);
						const result = await this.callTool(toolCall.name, toolCall.parameters);

						if (toolCall.name === 'submit_time_entry' && result.success === true) {
							timeEntryActuallySubmitted = true;
							console.log(`[BillingMCP] TIME ENTRY SUBMITTED SUCCESSFULLY`);
						}

						toolResults.push({ role: 'tool', content: JSON.stringify(result), toolCallId: toolCall.id });
					} catch (error: any) {
						console.error(`[BillingMCP] Tool ${toolCall.name} failed:`, error);
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

				// Set next iteration prompt
				if (timeEntryActuallySubmitted) {
					currentMessage = 'Time entry submitted successfully. Confirm to user with details (no QBO IDs).';
				} else if (timeEntryError) {
					currentMessage = `Time entry failed: ${timeEntryError}. Report this error to user.`;
				} else {
					currentMessage = 'Continue. You have the lookup results. Now call submit_time_entry with all the required fields.';
				}
			}

			if (iteration >= MAX_ITERATIONS) {
				yield 'Unable to complete the time entry after multiple attempts. Please try again.';
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
