// MoE Router - Routes requests to the appropriate expert based on classification
// Uses confidence threshold to determine routing strategy

import { MoEClassifier, type ClassificationResult } from './moe-classifier';
import { MCPServer } from './mcp-server';
import { BillingMCPServer } from './billing-mcp-server';
import { UnifiedMCPServer } from './unified-mcp-server';
import { MondayAgentExpert, type McpApprovalDecision } from './monday-agent';
import { BoxAgentExpert } from './box-agent';
import { MicrosoftGraphAuth } from './microsoft-graph-auth';
import { getChatHistoryAsync } from './chat-history-store';
import type { GenericChatMessage } from '$lib/utils/tokens';

// Confidence threshold for routing to specialized experts
const CONFIDENCE_THRESHOLD = 0.80;

export interface MoERequest {
	message: string;
	sessionId: string;
}

export interface MoEResponse {
	content: string;
	classification: ClassificationResult;
	expert: 'appointments' | 'billing' | 'monday' | 'box' | 'unified';
}

export interface MoERouterConfig {
	openaiApiKey: string;
	sessionId: string;
	authService?: MicrosoftGraphAuth;
	accessToken?: string;
	loggedInUser?: { name: string; email: string };
	webhookUrl?: string;
	azureAgentEndpoint?: string;
	azureAgentId?: string;
	azureBoxAgentId?: string;
}

export class MoERouter {
	private classifier: MoEClassifier;
	private appointmentsExpert: MCPServer | null = null;
	private billingExpert: BillingMCPServer | null = null;
	private unifiedExpert: UnifiedMCPServer | null = null;
	private mondayExpert: MondayAgentExpert | null = null;
	private boxExpert: BoxAgentExpert | null = null;
	private config: MoERouterConfig;
	private lastClassification: ClassificationResult | null = null;

	constructor(config: MoERouterConfig) {
		this.config = config;
		this.classifier = new MoEClassifier(config.openaiApiKey);
	}

	/**
	 * Get the appointments expert (lazy initialization)
	 */
	private getAppointmentsExpert(): MCPServer {
		if (!this.appointmentsExpert) {
			this.appointmentsExpert = new MCPServer(
				this.config.openaiApiKey,
				this.config.sessionId,
				this.config.authService,
				this.config.accessToken,
				this.config.loggedInUser
			);
		}
		return this.appointmentsExpert;
	}

	/**
	 * Get the billing expert (lazy initialization)
	 */
	private getBillingExpert(): BillingMCPServer {
		if (!this.billingExpert) {
			this.billingExpert = new BillingMCPServer(
				this.config.openaiApiKey,
				this.config.sessionId,
				this.config.loggedInUser,
				this.config.webhookUrl
			);
		}
		return this.billingExpert;
	}

	/**
	 * Get the unified expert (lazy initialization)
	 */
	private getUnifiedExpert(): UnifiedMCPServer {
		if (!this.unifiedExpert) {
			this.unifiedExpert = new UnifiedMCPServer(
				this.config.openaiApiKey,
				this.config.sessionId,
				this.config.authService,
				this.config.accessToken,
				this.config.loggedInUser,
				this.config.webhookUrl
			);
		}
		return this.unifiedExpert;
	}

	private getMondayExpert(): MondayAgentExpert {
		if (!this.mondayExpert) {
			const { azureAgentEndpoint, azureAgentId } = this.config;
			if (!azureAgentEndpoint || !azureAgentId) {
				throw new Error('Azure agent endpoint and agent ID must be configured for the Monday expert');
			}
			this.mondayExpert = new MondayAgentExpert(
				azureAgentEndpoint,
				azureAgentId,
				this.config.openaiApiKey
			);
		}
		return this.mondayExpert;
	}

	private getBoxExpert(): BoxAgentExpert {
		if (!this.boxExpert) {
			const { azureAgentEndpoint, azureBoxAgentId } = this.config;
			if (!azureAgentEndpoint || !azureBoxAgentId) {
				throw new Error('Azure agent endpoint and Box agent ID must be configured for the Box expert');
			}
			this.boxExpert = new BoxAgentExpert(azureAgentEndpoint, azureBoxAgentId);
		}
		return this.boxExpert;
	}

	/**
	 * Get the last classification result
	 */
	getLastClassification(): ClassificationResult | null {
		return this.lastClassification;
	}

	/**
	 * Classify a message and return the result
	 */
	async classifyMessage(message: string, sessionId?: string): Promise<ClassificationResult> {
		// First try quick pattern matching
		const quickResult = this.classifier.quickClassify(message);
		if (quickResult) {
			console.log(`[MoE Router] Quick classification: ${quickResult.category} (${quickResult.confidence})`);
			this.lastClassification = quickResult;
			return quickResult;
		}

		// Load recent chat history for context (helps classify follow-up queries)
		let chatHistory: Array<{ role: string; content?: string | null | unknown }> = [];
		if (sessionId) {
			try {
				const fullHistory = await getChatHistoryAsync(sessionId);
				// Take last 4 messages for classification context
				chatHistory = fullHistory.slice(-4).map(msg => ({
					role: msg.role,
					content: typeof msg.content === 'string' ? msg.content : '',
				}));
			} catch (e) {
				console.warn('[MoE Router] Could not load chat history for classification:', e);
			}
		}

		// Fall back to LLM classification with chat history context
		const classification = await this.classifier.classify(message, chatHistory as any);
		console.log(`[MoE Router] LLM classification: ${classification.category} (${classification.confidence}) - ${classification.reasoning}`);
		this.lastClassification = classification;
		return classification;
	}

	/**
	 * Determine which expert to use based on classification
	 */
	private determineExpert(classification: ClassificationResult): 'appointments' | 'billing' | 'monday' | 'box' | 'unified' {
		if (classification.category === 'monday') {
			return 'monday';
		}
		if (classification.category === 'box') {
			return 'box';
		}
		if (classification.category === 'appointments') {
			return 'appointments';
		}
		if (classification.category === 'billing') {
			return 'billing';
		}
		if (classification.confidence >= CONFIDENCE_THRESHOLD && classification.category === 'general') {
			return 'unified';
		}
		// Low confidence or general category -> unified expert
		return 'unified';
	}

	/**
	 * Handle a streaming request - routes to appropriate expert
	 */
	async *handleRequestStream(request: MoERequest): AsyncGenerator<string> {
		const { message, sessionId } = request;

		if (!message) {
			yield JSON.stringify({ error: 'Message is required' });
			return;
		}

		// Step 1: Classify the message (pass sessionId for chat history context)
		const classification = await this.classifyMessage(message, sessionId);
		const lower = message.toLowerCase();
		const hasTimeEntryIndicators =
			/\b(log|record|submit|entry)\b/i.test(lower) ||
			/\b\d+(\.\d+)?\s*(hours?|hrs?)\b/.test(lower) ||
			/\b(customer|client|tasks?|description|worked)\b/i.test(lower);
		const hasSchedulingIndicators =
			/\b(availability|available|free|schedule|booking|book|calendar)\b/i.test(lower);

		if (classification.reasoning === 'mixed_intent' && hasTimeEntryIndicators && hasSchedulingIndicators) {
			yield 'I can help with either calendar scheduling or time entry in a single request. Which would you like to do first?';
			return;
		}

		// Step 2: Determine which expert to use
		const expertType = this.determineExpert(classification);
		console.log(`[MoE Router] Routing to ${expertType} expert (confidence: ${classification.confidence})`);

		// Yield classification info for UI (optional metadata)
		if (expertType !== 'monday') {
			yield `[CLASSIFICATION:${JSON.stringify({ expert: expertType, category: classification.category, confidence: classification.confidence })}]\n`;
		}

		// Step 3: Route to the appropriate expert
		try {
			switch (expertType) {
				case 'appointments': {
					const expert = this.getAppointmentsExpert();
					const mcpRequest = {
						jsonrpc: '2.0' as const,
						id: Date.now(),
						method: 'chat' as const,
						params: { message, sessionId },
					};
					for await (const chunk of expert.handleRequestStream(mcpRequest)) {
						yield chunk;
					}
					break;
				}

				case 'billing': {
					const expert = this.getBillingExpert();
					for await (const chunk of expert.handleRequestStream({ message, sessionId })) {
						yield chunk;
					}
					break;
				}

				case 'monday': {
					yield `[CLASSIFICATION:${JSON.stringify({ expert: 'monday', category: 'monday', confidence: classification.confidence })}]\n`;
					const expert = this.getMondayExpert();
					for await (const chunk of expert.handleRequestStream({ message, sessionId,
						userEmail: this.config.loggedInUser?.email,
						userName: this.config.loggedInUser?.name,
					 })) {
						yield chunk;
					}
					break;
				}

				case 'box': {
					yield `[CLASSIFICATION:${JSON.stringify({ expert: 'box', category: 'box', confidence: classification.confidence })}]\n`;
					const expert = this.getBoxExpert();
					for await (const chunk of expert.handleRequestStream({
						message,
						sessionId,
						userEmail: this.config.loggedInUser?.email,
						userName: this.config.loggedInUser?.name,
					})) {
						yield chunk;
					}
					break;
				}

				case 'unified':
				default: {
					const expert = this.getUnifiedExpert();
					for await (const chunk of expert.handleRequestStream({ message, sessionId })) {
						yield chunk;
					}
					break;
				}
			}
		} catch (error: any) {
			console.error(`[MoE Router] Error in ${expertType} expert:`, error);
			yield `\n\n[Error: ${error.message}]`;
		}
	}

	/**
	 * Handle an MCP tool approval decision for the Monday expert.
	 * Returns an async generator that yields the continuation (text or another approval marker).
	 */
	async *handleAgentApproval(expertType: 'monday' | 'box', decision: McpApprovalDecision): AsyncGenerator<string> {
		if (expertType === 'box') {
			const expert = this.getBoxExpert();
			yield `[CLASSIFICATION:${JSON.stringify({ expert: 'box', category: 'box', confidence: 1 })}]\n`;
			for await (const chunk of expert.handleApprovalStream(decision)) {
				yield chunk;
			}
			return;
		}

		const expert = this.getMondayExpert();
		yield `[CLASSIFICATION:${JSON.stringify({ expert: 'monday', category: 'monday', confidence: 1 })}]\n`;
		for await (const chunk of expert.handleApprovalStream(decision)) {
			yield chunk;
		}
	}

	/**
	 * Clear history for all experts
	 */
	clearHistory(): void {
		this.appointmentsExpert?.clearHistory();
		this.billingExpert?.clearHistory();
		this.unifiedExpert?.clearHistory();
		if (this.mondayExpert) {
			this.mondayExpert.clearThread(this.config.sessionId);
		}
		if (this.boxExpert) {
			this.boxExpert.clearThread(this.config.sessionId);
		}
	}
}

/**
 * Parse classification metadata from stream chunk
 */
export function parseClassificationFromStream(chunk: string): { expert: string; category: string; confidence: number } | null {
	const match = chunk.match(/\[CLASSIFICATION:(.+?)\]/);
	if (match) {
		try {
			return JSON.parse(match[1]);
		} catch {
			return null;
		}
	}
	return null;
}
