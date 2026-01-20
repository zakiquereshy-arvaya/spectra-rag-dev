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
							// Parse date string
							const dateStr = match[1];
							if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
								const [month, day, year] = dateStr.split('/').map(Number);
								info.entry_date = new Date(year, month - 1, day).toISOString().split('T')[0];
							} else if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
								info.entry_date = dateStr;
							}
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

**INTERNAL WORKFLOW (CRITICAL - MUST FOLLOW):**
1. User: "log 2 hours for ICE - worked on migration"
2. You MUST silently call lookup_employee("${this.loggedInUser?.name || ''}") to get employee_qbo_id
3. You MUST silently call lookup_customer("ICE") to get customer_qbo_id
4. You MUST call submit_time_entry with ALL required fields (employee_name, employee_qbo_id, customer_name, customer_qbo_id, tasks_completed, hours, entry_date)
5. ONLY AFTER submit_time_entry returns success=true, you respond: "Logged 2 hours for Infrastructure Consulting & Engineering: worked on migration"

**CRITICAL RULES:**
- NEVER claim to have logged time without actually calling submit_time_entry
- NEVER say "Logged X hours" unless submit_time_entry tool was called and returned success=true
- You MUST call submit_time_entry when user requests time logging - it is REQUIRED, not optional
- If you have all the information (employee, customer, hours, tasks), you MUST call submit_time_entry immediately
- The logged-in user IS the employee - NEVER ask who they are
- "Arvaya" and "ICE" are customer names
- When user says "today", use entry_date="${todayStr}" (YYYY-MM-DD format)
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

				// Check if AI claims to have logged time but didn't call the tool
				const claimsLogged = this.claimsToHaveLoggedTime(fullText);
				const hasSubmitCall = toolCalls.some(tc => tc.name === 'submit_time_entry');
				
				// If AI claims to have logged but didn't call tool, check if we can force it
				if (claimsLogged && !hasSubmitCall && !timeEntryActuallySubmitted) {
					const timeEntryInfo = this.extractTimeEntryInfo();
					
					if (this.hasAllTimeEntryInfo(timeEntryInfo)) {
						console.log('[BillingMCP] AI claimed to log time but didn\'t call tool. Forcing submit_time_entry with extracted info:', timeEntryInfo);
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
						console.log('[BillingMCP] AI claimed to log time but missing info. Forcing lookup.', timeEntryInfo);
						currentMessage = `You claimed to have logged time, but you must actually call submit_time_entry. First call lookup_employee and lookup_customer if needed, then call submit_time_entry with all required fields. Do not claim success until the tool is called.`;
						continue;
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
