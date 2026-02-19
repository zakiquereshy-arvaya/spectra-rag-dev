import { AIProjectClient } from '@azure/ai-projects';
import { DefaultAzureCredential, ClientSecretCredential } from '@azure/identity';
import type { TokenCredential } from '@azure/core-auth';
import { env } from '$env/dynamic/private';

export interface BoxAgentRequest {
	message: string;
	sessionId: string;
	userEmail?: string;
	userName?: string;
}

export interface BoxMcpApprovalRequestData {
	expert: 'box';
	conversationId: string;
	responseId: string;
	approvalRequestId: string;
	toolName: string;
	serverLabel: string;
	arguments: Record<string, unknown>;
}

export interface BoxMcpApprovalDecision {
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

interface BoxSourceRef {
	title: string;
	url?: string;
}

export class BoxAgentExpert {
	private client: AIProjectClient;
	private agentName: string;
	private resolvedAgentDisplayName: string | null = null;
	private openAIClientPromise: Promise<any> | null = null;

	constructor(endpoint: string, agentName: string) {
		const credential = BoxAgentExpert.buildCredential();
		this.client = new AIProjectClient(endpoint, credential);
		this.agentName = agentName.trim();
	}

	private static buildCredential(): TokenCredential {
		const tenantId = env.AZURE_TENANT_ID || env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;
		const clientId = env.AZURE_CLIENT_ID || env.AUTH_MICROSOFT_ENTRA_ID_ID;
		const clientSecret = env.AZURE_CLIENT_SECRET || env.AUTH_MICROSOFT_ENTRA_ID_SECRET;
		const isProduction = (env.NODE_ENV || process.env.NODE_ENV) === 'production';

		if (tenantId && clientId && clientSecret) {
			console.log('[BoxAgent] Using ClientSecretCredential for authentication');
			return new ClientSecretCredential(tenantId, clientId, clientSecret);
		}

		if (isProduction) {
			throw new Error(
				`[BoxAgent] Missing Azure client credentials in environment. ` +
					`Set either AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET ` +
					`or AUTH_MICROSOFT_ENTRA_ID_TENANT_ID/AUTH_MICROSOFT_ENTRA_ID_ID/AUTH_MICROSOFT_ENTRA_ID_SECRET.`
			);
		}

		console.log('[BoxAgent] Falling back to DefaultAzureCredential');
		return new DefaultAzureCredential();
	}

	private async getAgentDisplayName(): Promise<string> {
		if (this.resolvedAgentDisplayName) return this.resolvedAgentDisplayName;

		try {
			const retrievedAgent = await this.client.agents.get(this.agentName);
			const displayName = retrievedAgent?.versions?.latest?.name ?? retrievedAgent?.name ?? this.agentName;
			this.resolvedAgentDisplayName = displayName;
			console.log(`[BoxAgent] Resolved agent name: "${displayName}" (id: ${retrievedAgent?.id})`);
			return displayName;
		} catch (err: any) {
			console.warn(`[BoxAgent] Could not retrieve agent "${this.agentName}", using configured name:`, err?.message);
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

	private parseSourcesFromAnnotations(annotations: any[] | undefined): BoxSourceRef[] {
		if (!Array.isArray(annotations)) return [];

		const refs: BoxSourceRef[] = [];
		for (const annotation of annotations) {
			const fileCitation = annotation?.file_citation || annotation?.fileCitation;
			const url =
				annotation?.url ||
				fileCitation?.url ||
				fileCitation?.file_url ||
				fileCitation?.fileUrl ||
				annotation?.source?.url;

			const titleCandidate =
				annotation?.title ||
				fileCitation?.title ||
				fileCitation?.filename ||
				fileCitation?.file_name ||
				annotation?.text ||
				'Source';
			const title = String(titleCandidate).trim() || 'Source';
			const normalizedUrl =
				typeof url === 'string' && /^https?:\/\//i.test(url) ? url : undefined;

			refs.push({
				title,
				url: normalizedUrl,
			});
		}

		return refs;
	}

	private parseSourcesFromOutput(output: any[] | undefined): BoxSourceRef[] {
		if (!Array.isArray(output)) return [];

		const refs: BoxSourceRef[] = [];

		for (const item of output) {
			const content = item?.content;
			if (!Array.isArray(content)) continue;

			for (const part of content) {
				const textContainer = part?.text;
				refs.push(...this.parseSourcesFromAnnotations(textContainer?.annotations));
				refs.push(...this.parseSourcesFromAnnotations(part?.annotations));
				refs.push(...this.parseSourcesFromAnnotations(part?.citations));
			}
		}

		return refs;
	}

	private parseSourcesFromText(text: string): BoxSourceRef[] {
		if (!text) return [];

		const refs: BoxSourceRef[] = [];
		const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
		const urlRegex = /\bhttps?:\/\/[^\s)]+/g;

		for (const match of text.matchAll(markdownLinkRegex)) {
			const title = match[1]?.trim() || 'Source';
			const url = match[2]?.trim();
			if (url) refs.push({ title, url });
		}

		for (const match of text.matchAll(urlRegex)) {
			const url = match[0]?.trim();
			if (!url) continue;
			refs.push({ title: 'Source', url });
		}

		return refs;
	}

	private dedupeSources(sources: BoxSourceRef[]): BoxSourceRef[] {
		const seen = new Set<string>();
		const deduped: BoxSourceRef[] = [];

		for (const source of sources) {
			const key = (source.url || source.title).toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			deduped.push(source);
		}

		return deduped;
	}

	private appendSourcesSection(text: string, sources: BoxSourceRef[]): string {
		const base = text.trim();
		if (!base) return '';

		if (/^#{1,4}\s+sources\b/im.test(base) || /^sources\s*:/im.test(base)) {
			return base;
		}

		if (sources.length === 0) return base;

		const sourceLines = sources.map((source) =>
			source.url ? `- [${source.title}](${source.url})` : `- ${source.title}`
		);
		return `${base}\n\n### Sources\n${sourceLines.join('\n')}`;
	}

	private buildResponseText(response: any): string {
		const text: string = typeof response?.output_text === 'string' ? response.output_text : '';
		const sources = this.dedupeSources([
			...this.parseSourcesFromOutput(response?.output),
			...this.parseSourcesFromText(text),
		]);
		return this.appendSourcesSection(text, sources);
	}

	async *handleRequestStream(request: BoxAgentRequest): AsyncGenerator<string> {
		const { message, userEmail, userName } = request;

		try {
			const agentDisplayName = await this.getAgentDisplayName();
			const openAIClient = await this.getOpenAIClient();

			const conversation = await openAIClient.conversations.create({
				items: [
					{
						type: 'message',
						role: 'system',
						content: `LOGGED-IN USER
  - Name: ${userName || 'Unknown'}
  - Email: ${userEmail || 'no email'}`,
					},
					{ type: 'message', role: 'user', content: message },
				],
			});

			console.log(`[BoxAgent] Created conversation: ${conversation.id}`);

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
				} catch {
					// Keep empty args on parse errors.
				}

				const approvalData: BoxMcpApprovalRequestData = {
					expert: 'box',
					conversationId: conversation.id,
					responseId: response.id,
					approvalRequestId: req.id,
					toolName: req.name,
					serverLabel: req.server_label,
					arguments: parsedArgs,
				};

				yield `[MCP_APPROVAL:${JSON.stringify(approvalData)}]`;
				return;
			}

			const rendered = this.buildResponseText(response);
			if (rendered.length > 0) {
				yield rendered;
			} else {
				yield 'The Box agent did not return a response. Please try again.';
			}
		} catch (error: any) {
			this.throwFormattedError(error);
		}
	}

	async *handleApprovalStream(decision: BoxMcpApprovalDecision): AsyncGenerator<string> {
		try {
			const agentDisplayName = await this.getAgentDisplayName();
			const openAIClient = await this.getOpenAIClient();

			let previousResponseId = decision.responseId;
			let approvalRequestId = decision.approvalRequestId;
			let approve = decision.approve;
			let reason = decision.reason;

			const MAX_APPROVAL_ROUNDS = 10;
			for (let round = 0; round < MAX_APPROVAL_ROUNDS; round++) {
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
					} catch {
						// Keep empty args on parse errors.
					}

					const approvalData: BoxMcpApprovalRequestData = {
						expert: 'box',
						conversationId: decision.conversationId,
						responseId: response.id,
						approvalRequestId: req.id,
						toolName: req.name,
						serverLabel: req.server_label,
						arguments: parsedArgs,
					};

					yield `[MCP_APPROVAL:${JSON.stringify(approvalData)}]`;
					return;
				}

				const rendered = this.buildResponseText(response);
				if (rendered.length > 0) {
					yield rendered;
					return;
				}

				yield 'The Box agent completed processing but returned no text.';
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
