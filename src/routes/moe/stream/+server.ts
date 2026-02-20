// MoE Stream endpoint - Routes to appropriate expert based on classification
import type { RequestHandler } from './$types';
import { MoERouter } from '$lib/services/moe-router';
import { MicrosoftGraphAuth } from '$lib/services/microsoft-graph-auth';
import { getAccessToken } from '$lib/utils/auth';
import { logEvent } from '$lib/services/ops-logger';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async (event) => {
	const session = await event.locals.auth();

	if (!session) {
		return new Response('Unauthorized', { status: 401 });
	}

	const openaiApiKey = env.OPENAI_API_KEY;
	if (!openaiApiKey) {
		return new Response('OpenAI API key not configured', { status: 500 });
	}

	// Set up Microsoft Graph auth
	const issuer = env.AUTH_MICROSOFT_ENTRA_ID_ISSUER || '';
	const tenantId = env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID || (issuer ? issuer.split('/')[3] : null);
	const clientId = env.AUTH_MICROSOFT_ENTRA_ID_ID;
	const clientSecret = env.AUTH_MICROSOFT_ENTRA_ID_SECRET;

	let authService: MicrosoftGraphAuth | undefined;
	if (tenantId && clientId && clientSecret) {
		authService = new MicrosoftGraphAuth(tenantId, clientId, clientSecret);
	}

	const accessToken = getAccessToken(session);

	try {
		const body = await event.request.json();
		const { message, sessionId } = body;

		if (!message) {
			return new Response(JSON.stringify({ error: 'Message is required' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		logEvent({
			user_email: session.user?.email ?? undefined,
			user_name: session.user?.name ?? undefined,
			event_type: 'chat_message',
			event_action: 'send_message',
			route: '/moe/stream',
			metadata: { sessionId, messageLength: message.length },
		});

		// Get logged-in user information
		const loggedInUser = session.user
			? {
					name: session.user.name || session.user.email || 'Unknown User',
					email: session.user.email || (session.user as any).userPrincipalName || '',
				}
			: undefined;

		// Create MoE Router
		const router = new MoERouter({
			openaiApiKey,
			sessionId: sessionId || 'default',
			authService,
			accessToken: accessToken || undefined,
			loggedInUser,
			webhookUrl: env.BILLI_DEV_WEBHOOK_URL,
			azureAgentEndpoint: env.AZURE_EXISTING_AIPROJECT_ENDPOINT,
			azureAgentId: env.AZURE_EXISTING_AGENT_ID,
			azureBoxAgentId: env.AZURE_BOX_AGENT_ID,
		});

		// Create streaming response
		const stream = new ReadableStream({
			async start(controller) {
				const encoder = new TextEncoder();

				try {
					for await (const chunk of router.handleRequestStream({ message, sessionId })) {
						controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`));
					}
					controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
				} catch (error: any) {
					console.error('[MoE Stream] Error:', error);
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
		console.error('[MoE Stream] API error:', error);
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
