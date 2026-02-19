import type { RequestHandler } from './$types';
import { MoERouter } from '$lib/services/moe-router';
import { MicrosoftGraphAuth } from '$lib/services/microsoft-graph-auth';
import { getAccessToken } from '$lib/utils/auth';
import { env } from '$env/dynamic/private';
import {
	OPENAI_API_KEY,
	AUTH_MICROSOFT_ENTRA_ID_ID,
	AUTH_MICROSOFT_ENTRA_ID_SECRET,
	AUTH_MICROSOFT_ENTRA_ID_ISSUER,
	AUTH_MICROSOFT_ENTRA_ID_TENANT_ID,
	BILLI_DEV_WEBHOOK_URL,
	AZURE_EXISTING_AIPROJECT_ENDPOINT,
	AZURE_EXISTING_AGENT_ID,
} from '$env/static/private';

export const POST: RequestHandler = async (event) => {
	const session = await event.locals.auth();
	if (!session) {
		return new Response('Unauthorized', { status: 401 });
	}

	const openaiApiKey = OPENAI_API_KEY;
	if (!openaiApiKey) {
		return new Response('OpenAI API key not configured', { status: 500 });
	}

	const issuer = AUTH_MICROSOFT_ENTRA_ID_ISSUER || '';
	const tenantId = AUTH_MICROSOFT_ENTRA_ID_TENANT_ID || (issuer ? issuer.split('/')[3] : null);
	const clientId = AUTH_MICROSOFT_ENTRA_ID_ID;
	const clientSecret = AUTH_MICROSOFT_ENTRA_ID_SECRET;

	let authService: MicrosoftGraphAuth | undefined;
	if (tenantId && clientId && clientSecret) {
		authService = new MicrosoftGraphAuth(tenantId, clientId, clientSecret);
	}

	const accessToken = getAccessToken(session);

	try {
		const body = await event.request.json();
		const { sessionId, conversationId, responseId, approvalRequestId, approve, reason, expert } = body;
		const targetExpert: 'monday' | 'box' = expert === 'box' ? 'box' : 'monday';

		if (!conversationId || !responseId || !approvalRequestId || typeof approve !== 'boolean') {
			return new Response(
				JSON.stringify({ error: 'Missing required fields: conversationId, responseId, approvalRequestId, approve' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		const loggedInUser = session.user
			? {
					name: session.user.name || session.user.email || 'Unknown User',
					email: session.user.email || (session.user as any).userPrincipalName || '',
				}
			: undefined;

		const router = new MoERouter({
			openaiApiKey,
			sessionId: sessionId || 'default',
			authService,
			accessToken: accessToken || undefined,
			loggedInUser,
			webhookUrl: BILLI_DEV_WEBHOOK_URL,
			azureAgentEndpoint: AZURE_EXISTING_AIPROJECT_ENDPOINT,
			azureAgentId: AZURE_EXISTING_AGENT_ID,
			azureBoxAgentId: env.AZURE_BOX_AGENT_ID,
		});

		const stream = new ReadableStream({
			async start(controller) {
				const encoder = new TextEncoder();
				try {
					for await (const chunk of router.handleAgentApproval(targetExpert, {
						conversationId,
						responseId,
						approvalRequestId,
						approve,
						reason,
					})) {
						controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`));
					}
					controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
				} catch (error: any) {
					console.error('[MoE Approve] Error:', error);
					controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`));
				} finally {
					controller.close();
				}
			},
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			},
		});
	} catch (error: any) {
		console.error('[MoE Approve] API error:', error);
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
