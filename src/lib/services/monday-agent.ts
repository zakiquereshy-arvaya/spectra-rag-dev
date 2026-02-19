import { AIProjectClient } from '@azure/ai-projects';
import { DefaultAzureCredential, ClientSecretCredential } from '@azure/identity';
import type { TokenCredential } from '@azure/core-auth';
import { env } from '$env/dynamic/private';
import { OpenAIService } from './openai-service';

export interface MondayAgentRequest {
	message: string;
	sessionId: string;
	userEmail?: string;
	userName?: string;
}

export interface McpApprovalRequestData {
	expert?: 'monday';
	conversationId: string;
	responseId: string;
	approvalRequestId: string;
	toolName: string;
	serverLabel: string;
	arguments: Record<string, unknown>;
}

export interface McpApprovalDecision {
	conversationId: string;
	responseId: string;
	approvalRequestId: string;
	approve: boolean;
	reason?: string;
}

interface McpApprovalRequestItem {
	type: 'mcp_approval_request';
	id: string;
	name: string;
	server_label: string;
	arguments: string;
}

interface TopSummaryResult {
	markdown: string;
	summary: string | null;
}

export class MondayAgentExpert {
	private client: AIProjectClient;
	private agentName: string;
	private resolvedAgentDisplayName: string | null = null;
	private openAIClientPromise: Promise<any> | null = null;
	private openAIService: OpenAIService | null = null;

	constructor(endpoint: string, agentName: string, openaiApiKey?: string) {
		const credential = MondayAgentExpert.buildCredential();
		this.client = new AIProjectClient(endpoint, credential);
		this.agentName = agentName.trim();
		if (openaiApiKey?.trim()) {
			this.openAIService = new OpenAIService(openaiApiKey.trim());
		}
	}

	/**
	 * Build a TokenCredential for the Azure AI Projects client.
	 * Prefers explicit ClientSecretCredential from env vars (works in deployed
	 * environments without Azure CLI). Falls back to DefaultAzureCredential
	 * for local dev (az login, VS Code, managed identity, etc.).
	 */
	private static buildCredential(): TokenCredential {
		const tenantId = env.AZURE_TENANT_ID || env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;
		const clientId = env.AZURE_CLIENT_ID || env.AUTH_MICROSOFT_ENTRA_ID_ID;
		const clientSecret = env.AZURE_CLIENT_SECRET || env.AUTH_MICROSOFT_ENTRA_ID_SECRET;
		const isProduction = (env.NODE_ENV || process.env.NODE_ENV) === 'production';

		if (tenantId && clientId && clientSecret) {
			console.log('[MondayAgent] Using ClientSecretCredential for authentication');
			return new ClientSecretCredential(tenantId, clientId, clientSecret);
		}

		if (isProduction) {
			throw new Error(
				`[MondayAgent] Missing Azure client credentials in environment. ` +
				`Set either AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET ` +
				`or AUTH_MICROSOFT_ENTRA_ID_TENANT_ID/AUTH_MICROSOFT_ENTRA_ID_ID/AUTH_MICROSOFT_ENTRA_ID_SECRET.`
			);
		}

		console.log('[MondayAgent] Falling back to DefaultAzureCredential');
		return new DefaultAzureCredential();
	}

	private async getAgentDisplayName(): Promise<string> {
		if (this.resolvedAgentDisplayName) return this.resolvedAgentDisplayName;

		try {
			const retrievedAgent = await this.client.agents.get(this.agentName);
			const displayName = retrievedAgent?.versions?.latest?.name ?? retrievedAgent?.name ?? this.agentName;
			this.resolvedAgentDisplayName = displayName;
			console.log(`[MondayAgent] Resolved agent name: "${displayName}" (id: ${retrievedAgent?.id})`);
			return displayName;
		} catch (err: any) {
			console.warn(`[MondayAgent] Could not retrieve agent "${this.agentName}", using configured name:`, err?.message);
			this.resolvedAgentDisplayName = this.agentName;
			return this.agentName;
		}
	}

	private async getOpenAIClient(): Promise<any> {
		if (!this.openAIClientPromise) {
			this.openAIClientPromise = this.client.getOpenAIClient();
		}
		return this.openAIClientPromise;
	}

	private findApprovalRequests(output: any[]): McpApprovalRequestItem[] {
		return (output || []).filter(
			(item: any) => item?.type === 'mcp_approval_request'
		) as McpApprovalRequestItem[];
	}

	private getSectionBody(markdown: string, sectionTitle: string): string | null {
		const escapedTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const sectionRegex = new RegExp(
			`^#{1,4}\\s+${escapedTitle}\\s*$([\\s\\S]*?)(?=^#{1,4}\\s+|$)`,
			'im'
		);
		const match = markdown.match(sectionRegex);
		if (!match) return null;
		return match[1]?.trim() ?? '';
	}

	private splitIntroAndBody(markdown: string): { intro: string; body: string } {
		const headingMatch = markdown.match(/^#{1,4}\s+/m);
		if (!headingMatch || headingMatch.index === undefined) {
			return { intro: markdown.trim(), body: '' };
		}

		const idx = headingMatch.index;
		return {
			intro: markdown.slice(0, idx).trim(),
			body: markdown.slice(idx).trimStart(),
		};
	}

	private isMondayActionReport(markdown: string): boolean {
		if (!markdown || !/^#{1,4}\s+/m.test(markdown)) return false;
		return /\b(monday|action.?items?|current plate|backlog|prep)\b/i.test(markdown);
	}

	private async enrichTopSummary(markdown: string, userName?: string): Promise<TopSummaryResult> {
		if (!this.openAIService || !this.isMondayActionReport(markdown)) {
			return {
				markdown: markdown.replace(/^Here are your current action items:?\s*\n?/im, ''),
				summary: null,
			};
		}

		const { body } = this.splitIntroAndBody(markdown);
		if (!body) return { markdown, summary: null };

		try {
			const prompt = [
				'You are improving a Monday.com action-item report for readability.',
				'Generate a concise AI summary at the top of the report.',
				'Return markdown only (no code fences) and NO headings.',
				'Format:',
				'- First line: one sentence overall summary.',
				'- Then grouped bullets for action items by: Current Plate, Prep, Backlog.',
				'- Use only groups that exist in the report.',
				'- Keep each group to 1-2 bullets with status/risk context.',
				'- Keep the whole summary short and easy to scan.',
				'- Do NOT use the phrase "Here are your current action items".',
				`Logged-in user: ${userName || 'Unknown User'}`,
				'',
				'REPORT:',
				body,
			].join('\n');

			const summaryResponse = await this.openAIService.chat(prompt);
			const summary = summaryResponse.text?.trim();
			if (!summary) return { markdown, summary: null };

			const nextMarkdown = `${summary}\n\n${body}`;
			return { markdown: nextMarkdown, summary };
		} catch (error) {
			console.warn('[MondayAgent] Failed to generate top action summary:', error);
			return { markdown, summary: null };
		}
	}

	private shouldEnrichActionItemsOverview(markdown: string): boolean {
		const hasOverviewHeading = /^#{1,4}\s+Action Items Overview\s*$/im.test(markdown);
		if (!hasOverviewHeading) return false;
		const overviewBody = this.getSectionBody(markdown, 'Action Items Overview');
		return overviewBody !== null && overviewBody.length === 0;
	}

	private async enrichActionItemsOverview(
		markdown: string,
		userName?: string,
		fallbackSummary?: string | null
	): Promise<string> {
		if (!this.shouldEnrichActionItemsOverview(markdown)) {
			return markdown;
		}

		if (fallbackSummary?.trim()) {
			return markdown.replace(
				/^(#{1,4}\s+Action Items Overview\s*)$/im,
				'$1\n\n- See AI summary above for grouped status across Current Plate, Prep, and Backlog.\n'
			);
		}

		if (!this.openAIService) return markdown;

		try {
			const prompt = [
				'You are improving a Monday.com markdown report.',
				'The report has an empty "Action Items Overview" section.',
				'Generate ONLY the body content for that section in concise markdown bullet points.',
				'Rules:',
				'- Use only facts present in the report.',
				'- Focus on action items assigned to the logged-in user when identifiable.',
				'- Mention status and due-date risk briefly when available.',
				'- Keep it to 3-5 bullets total.',
				'- Do not add a heading.',
				`Logged-in user: ${userName || 'Unknown User'}`,
				'',
				'REPORT:',
				markdown,
			].join('\n');

			const summaryResponse = await this.openAIService.chat(prompt);
			const summary = summaryResponse.text?.trim();
			if (!summary) return markdown;

			return markdown.replace(
				/^(#{1,4}\s+Action Items Overview\s*)$/im,
				`$1\n\n${summary}\n`
			);
		} catch (error) {
			console.warn('[MondayAgent] Failed to enrich Action Items Overview:', error);
			return markdown;
		}
	}

	private async enrichMondayReport(markdown: string, userName?: string): Promise<string> {
		const topSummaryResult = await this.enrichTopSummary(markdown, userName);
		return this.enrichActionItemsOverview(
			topSummaryResult.markdown,
			userName,
			topSummaryResult.summary
		);
	}

	async *handleRequestStream(request: MondayAgentRequest): AsyncGenerator<string> {
		const { message } = request;

		try {
			const agentDisplayName = await this.getAgentDisplayName();
			const openAIClient = await this.getOpenAIClient();

			const conversation = await openAIClient.conversations.create({
				items: [
					{
						type: 'message',
						role: 'system',
					content: `LOGGED-IN USER
			  - Name: ${request.userName || 'Unknown'}
			  - Email: ${request.userEmail || 'no email'}`,
					},
					{ type: 'message', role: 'user', content: message },
				],
			});

			console.log(`[MondayAgent] Created conversation: ${conversation.id}`);

			const response = await openAIClient.responses.create(
				{ conversation: conversation.id },
				{ body: { agent: { name: agentDisplayName, type: 'agent_reference' } } }
			);

			const approvalRequests = this.findApprovalRequests(response?.output);

			if (approvalRequests.length > 0) {
				const req = approvalRequests[0];
				let parsedArgs: Record<string, unknown> = {};
				try {
					parsedArgs = JSON.parse(req.arguments);
				} catch { /* keep empty */ }

				const approvalData: McpApprovalRequestData = {
					expert: 'monday',
					conversationId: conversation.id,
					responseId: response.id,
					approvalRequestId: req.id,
					toolName: req.name,
					serverLabel: req.server_label,
					arguments: parsedArgs,
				};

				console.log(`[MondayAgent] MCP approval required: ${req.name} (${req.id})`);
				yield `[MCP_APPROVAL:${JSON.stringify(approvalData)}]`;
				return;
			}

			const text: string | undefined = response?.output_text;
			if (typeof text === 'string' && text.length > 0) {
				const enrichedText = await this.enrichMondayReport(text, request.userName);
				yield enrichedText;
			} else {
				yield 'The Monday agent did not return a response. Please try again.';
			}
		} catch (error: any) {
			this.throwFormattedError(error);
		}
	}

	/**
	 * Continue a conversation after the user approves or denies a tool call.
	 * Loops in case the agent requests additional approvals.
	 */
	async *handleApprovalStream(decision: McpApprovalDecision): AsyncGenerator<string> {
		try {
			const agentDisplayName = await this.getAgentDisplayName();
			const openAIClient = await this.getOpenAIClient();

			let previousResponseId = decision.responseId;
			let approvalRequestId = decision.approvalRequestId;
			let approve = decision.approve;
			let reason = decision.reason;

			const MAX_APPROVAL_ROUNDS = 10;
			for (let round = 0; round < MAX_APPROVAL_ROUNDS; round++) {
				console.log(`[MondayAgent] Sending approval (round ${round}): approve=${approve}, id=${approvalRequestId}`);

				const approvalItem: Record<string, unknown> = {
					type: 'mcp_approval_response',
					approval_request_id: approvalRequestId,
					approve,
				};
				if (!approve) {
					approvalItem.reason = reason || 'User denied';
				}

				const response = await openAIClient.responses.create(
					{
						previous_response_id: previousResponseId,
						input: [approvalItem],
					},
					{ body: { agent: { name: agentDisplayName, type: 'agent_reference' } } }
				);

				const nextApprovals = this.findApprovalRequests(response?.output);

				if (nextApprovals.length > 0) {
					const req = nextApprovals[0];
					let parsedArgs: Record<string, unknown> = {};
					try {
						parsedArgs = JSON.parse(req.arguments);
					} catch { /* keep empty */ }

					const approvalData: McpApprovalRequestData = {
						expert: 'monday',
						conversationId: decision.conversationId,
						responseId: response.id,
						approvalRequestId: req.id,
						toolName: req.name,
						serverLabel: req.server_label,
						arguments: parsedArgs,
					};

					console.log(`[MondayAgent] Additional MCP approval required: ${req.name} (${req.id})`);
					yield `[MCP_APPROVAL:${JSON.stringify(approvalData)}]`;
					return;
				}

				const text: string | undefined = response?.output_text;
				if (typeof text === 'string' && text.length > 0) {
					const enrichedText = await this.enrichMondayReport(text);
					yield enrichedText;
					return;
				}

				yield 'The Monday agent completed processing but returned no text.';
				return;
			}

			yield 'Too many approval rounds. Please try a simpler request.';
		} catch (error: any) {
			this.throwFormattedError(error);
		}
	}

	private throwFormattedError(error: any): never {
		const body = error?.response?.bodyAsText || error?.response?.parsedBody;
		if (body) {
			throw new Error(
				`Azure Foundry agent failed (${error?.statusCode ?? 'unknown'}): ${typeof body === 'string' ? body : JSON.stringify(body)}`
			);
		}
		throw error;
	}

	clearThread(_sessionId: string): void {
		// Conversations API is stateless per request; nothing to clear.
	}
}
