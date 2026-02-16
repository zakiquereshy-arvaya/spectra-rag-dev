
import { OpenAIService } from './openai-service';
import type { GenericChatMessage } from '$lib/utils/tokens';
import { MicrosoftGraphService } from './microsoft-graph';
import { MicrosoftGraphAuth } from './microsoft-graph-auth';
import { CalendarAIHelper } from './ai-calendar-helpers';
import { getChatHistoryAsync, setChatHistoryAsync } from './chat-history-store';
import { prepareChatHistory } from '$lib/utils/tokens';
import { buildSystemPrompt } from '$lib/prompts/billi-prompts';
import { ToolExecutor } from './tool-executor';
import {
	detectAvailabilityIntent,
	detectTimeEntryIntent,
	determineToolScope,
	isConfirmation,
	extractTextContent,
	formatAvailabilityResponse,
} from './intent-detector';

type StoredChatMessage = GenericChatMessage;

export interface UnifiedMCPRequest {
	message: string;
	sessionId: string;
}

export class UnifiedMCPServer {
	private openaiService: OpenAIService;
	private openaiApiKey: string;
	private toolExecutor: ToolExecutor;
	private sessionId: string;
	private chatHistory: StoredChatMessage[] = [];
	private loggedInUser: { name: string; email: string } | null = null;
	private lastTimestamp: number = 0;
	private historyLoaded: boolean = false;

	constructor(
		openaiApiKey: string,
		sessionId: string,
		authService?: MicrosoftGraphAuth,
		accessToken?: string,
		loggedInUser?: { name: string; email: string },
		webhookUrl?: string
	) {
		this.openaiApiKey = openaiApiKey;
		this.openaiService = new OpenAIService(openaiApiKey);
		const graphService = new MicrosoftGraphService(accessToken, authService);
		let aiHelper: CalendarAIHelper | null = null;
		try {
			aiHelper = new CalendarAIHelper(openaiApiKey);
		} catch {
			aiHelper = null;
		}
		this.toolExecutor = new ToolExecutor(graphService, aiHelper, loggedInUser || null, webhookUrl || '');
		this.sessionId = sessionId;
		this.loggedInUser = loggedInUser || null;
	}

	// ==================== HISTORY MANAGEMENT ====================

	async loadHistory(): Promise<void> {
		if (!this.historyLoaded) {
			this.chatHistory = await getChatHistoryAsync(this.sessionId);
			this.historyLoaded = true;
		}
	}

	async saveHistory(): Promise<void> {
		await setChatHistoryAsync(this.sessionId, this.chatHistory, this.openaiApiKey);
	}

	private pushToHistory(...messages: GenericChatMessage[]): void {
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

	// ==================== INTENT RESOLUTION ====================

	private parseDate(d: string): string {
		return this.toolExecutor.parseDate(d);
	}

	private resolveAvailabilityIntent(message: string): { name: string; date: string } | null {
		const direct = detectAvailabilityIntent(message, (d) => this.parseDate(d));
		if (direct) return direct;
		if (isConfirmation(message)) {
			return this.getRecentAvailabilityIntent();
		}
		return null;
	}

	private getRecentAvailabilityIntent(): { name: string; date: string } | null {
		for (let i = this.chatHistory.length - 1; i >= 0; i--) {
			const msg = this.chatHistory[i];
			if (msg.role !== 'user') continue;
			const text = extractTextContent(msg.content);
			const intent = detectAvailabilityIntent(text, (d) => this.parseDate(d));
			if (intent) return intent;
		}
		return null;
	}

	// ==================== STREAMING REQUEST HANDLER ====================

	async *handleRequestStream(request: UnifiedMCPRequest): AsyncGenerator<string> {
		const { message: userMessage } = request;

		if (!userMessage) {
			yield JSON.stringify({ error: 'Message is required' });
			return;
		}

		try {
			await this.loadHistory();

			const availabilityIntent = this.resolveAvailabilityIntent(userMessage);
			const toolScope = determineToolScope(userMessage, (d) => this.parseDate(d));
			const tools = toolScope === 'billing'
				? OpenAIService.createTimeEntryTools()
				: toolScope === 'calendar'
					? OpenAIService.createCalendarTools()
					: OpenAIService.createAllTools();

			// Fast path: direct availability check (skip LLM latency)
			if (availabilityIntent) {
				this.pushToHistory({ role: 'user', content: userMessage });
				const toolCallId = `availability-${Date.now()}`;
				try {
					yield `[TOOL_STATUS:${JSON.stringify({ tool: "check_availability", status: "executing", label: "Checking calendar..." })}]`;
					const toolResult = await this.toolExecutor.execute('check_availability', {
						user_email: availabilityIntent.name,
						date: availabilityIntent.date,
					});
					this.pushToHistory({
						role: 'tool',
						content: JSON.stringify(toolResult),
						toolCallId,
					});
					yield `[TOOL_RESULT:${JSON.stringify({ type: "availability", data: toolResult })}]`;
					const responseText = formatAvailabilityResponse(toolResult);
					this.pushToHistory({ role: 'assistant', content: responseText });
					yield responseText;
					await this.saveHistory();
					return;
				} catch (error: any) {
					const errorText = `I couldn't check availability: ${error.message}`;
					this.pushToHistory({
						role: 'tool',
						content: JSON.stringify({ success: false, error: error.message }),
						toolCallId,
					});
					this.pushToHistory({ role: 'assistant', content: errorText });
					yield errorText;
					await this.saveHistory();
					return;
				}
			}

			// Build system prompt scoped to detected intent
			const systemMessage: GenericChatMessage = {
				role: 'system',
				content: buildSystemPrompt(toolScope, this.loggedInUser, new Date()),
			};

			this.pushToHistory({ role: 'user', content: userMessage });

			// AGENTIC LOOP — keep executing tools until done (max 5 iterations)
			const MAX_ITERATIONS = 5;
			let iteration = 0;
			let currentMessage = userMessage;
			let timeEntryActuallySubmitted = false;
			let timeEntryError: string | null = null;

			while (iteration < MAX_ITERATIONS) {
				iteration++;
				console.log(`[UnifiedMCP] Agentic loop iteration ${iteration}`);

				const preparedHistory = prepareChatHistory(this.chatHistory);
				let fullText = '';
				const toolCalls: any[] = [];

				for await (const chunk of this.openaiService.chatStream(
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
					const responseText = fullText || 'How can I help you today?';
					yield responseText;
					this.pushToHistory({ role: 'assistant', content: responseText });
					break;
				}

				// Tool calls present — execute them silently
				const assistantMessage: GenericChatMessage = { role: 'assistant' };
				assistantMessage.toolCalls = toolCalls.map((tc) => ({
					id: tc.id,
					type: 'function' as const,
					function: { name: tc.name, arguments: JSON.stringify(tc.parameters) },
				}));
				this.pushToHistory(assistantMessage);

				const toolResults: GenericChatMessage[] = [];
				const availabilityResults: any[] = [];

				for (const toolCall of toolCalls) {
					try {
						const statusLabel = this.toolExecutor.getToolStatusLabel(toolCall.name);
						yield `[TOOL_STATUS:${JSON.stringify({ tool: toolCall.name, status: "executing", label: statusLabel })}]`;
						console.log(`[UnifiedMCP] Executing tool: ${toolCall.name}`);
						const result = await this.toolExecutor.execute(toolCall.name, toolCall.parameters);

						if (toolCall.name === "check_availability") {
							availabilityResults.push(result);
						}
						if (toolCall.name === "book_meeting" && result.validated_date_info) {
							yield `[TOOL_RESULT:${JSON.stringify({ type: "booking", data: result.validated_date_info })}]`;
						}
						if (toolCall.name === "submit_time_entry" && result.success === true) {
							timeEntryActuallySubmitted = true;
							yield `[TOOL_RESULT:${JSON.stringify({ type: "time_entry", data: result.timeEntry })}]`;
						}
						toolResults.push({ role: 'tool', content: JSON.stringify(result), toolCallId: toolCall.id });
					} catch (error: any) {
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

				if (availabilityResults.length === 1) {
					yield `[TOOL_RESULT:${JSON.stringify({ type: "availability", data: availabilityResults[0] })}]`;
				} else if (availabilityResults.length > 1) {
					yield `[TOOL_RESULT:${JSON.stringify({
						type: "availability",
						data: { results: availabilityResults },
					})}]`;
				}

				this.pushToHistory(...toolResults);

				// Context-aware continuation prompt
				if (timeEntryActuallySubmitted) {
					currentMessage = 'Time entry submitted successfully. Confirm to user with details (no QBO IDs).';
				} else if (timeEntryError) {
					currentMessage = `Time entry failed: ${timeEntryError}. Report this error to user.`;
				} else {
					const hasLookups = toolCalls.some(tc =>
						tc.name === 'lookup_employee' || tc.name === 'lookup_customer'
					);
					if (hasLookups) {
						currentMessage = 'You have lookup results. You MUST now call submit_time_entry with the employee_qbo_id and customer_qbo_id from the lookup results. Do not claim success without calling the tool.';
					} else {
						currentMessage = 'Continue with the task based on the tool results above.';
					}
				}
			}

			if (iteration >= MAX_ITERATIONS) {
				yield 'I was unable to complete the request after multiple attempts. Please try again with more specific information.';
			}

			await this.saveHistory();
		} catch (error: any) {
			console.error('[UnifiedMCP] Stream error:', error);
			yield '\n\n[Error: ' + error.message + ']';
		}
	}

	clearHistory(): void {
		this.chatHistory = [];
		this.historyLoaded = false;
	}
}
