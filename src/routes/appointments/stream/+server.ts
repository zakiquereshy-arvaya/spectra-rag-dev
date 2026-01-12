import type { RequestHandler } from './$types';
import { MCPServer } from '$lib/services/mcp-server';
import { MicrosoftGraphAuth } from '$lib/services/microsoft-graph-auth';
import { getAccessToken } from '$lib/utils/auth';
import { COHERE_API_KEY } from '$env/static/private';
import {
	AUTH_MICROSOFT_ENTRA_ID_ID,
	AUTH_MICROSOFT_ENTRA_ID_SECRET,
	AUTH_MICROSOFT_ENTRA_ID_ISSUER,
	AUTH_MICROSOFT_ENTRA_ID_TENANT_ID,
} from '$env/static/private';
import type { MCPRequest } from '$lib/types/mcp';

export const POST: RequestHandler = async (event) => {
	const session = await event.locals.auth();

	if (!session) {
		return new Response('Unauthorized', { status: 401 });
	}

	// Get Cohere API key
	const cohereApiKey = COHERE_API_KEY;
	if (!cohereApiKey) {
		return new Response('Cohere API key not configured', { status: 500 });
	}

	// Get Microsoft Graph credentials
	const issuer = AUTH_MICROSOFT_ENTRA_ID_ISSUER || '';
	const tenantId = AUTH_MICROSOFT_ENTRA_ID_TENANT_ID || (issuer ? issuer.split('/')[3] : null);
	const clientId = AUTH_MICROSOFT_ENTRA_ID_ID;
	const clientSecret = AUTH_MICROSOFT_ENTRA_ID_SECRET;

	if (!tenantId || !clientId || !clientSecret) {
		return new Response('Microsoft Graph authentication not configured', { status: 500 });
	}

	// Create app-only auth service
	const authService = new MicrosoftGraphAuth(tenantId, clientId, clientSecret);

	// Get delegated access token
	const accessToken = getAccessToken(session);

	try {
		const body = await event.request.json();
		const mcpRequest = body as MCPRequest & { params?: { message?: string; sessionId?: string } };

		// Get session ID from request params or generate one
		const sessionId = mcpRequest.params?.sessionId || 'default';

		// Get logged-in user information
		const loggedInUser = session.user
			? {
					name: session.user.name || session.user.email || 'Unknown User',
					email: session.user.email || (session.user as any).userPrincipalName || '',
				}
			: null;

		if (!loggedInUser || !loggedInUser.email) {
			return new Response('Unable to determine logged-in user', { status: 401 });
		}

		// Create MCP server instance
		const mcpServer = new MCPServer(
			cohereApiKey,
			sessionId,
			authService,
			accessToken || undefined,
			loggedInUser
		);

		// Create a ReadableStream for server-sent events
		const stream = new ReadableStream({
			async start(controller) {
				const encoder = new TextEncoder();

				try {
					// Stream the response
					for await (const chunk of mcpServer.handleRequestStream(mcpRequest)) {
						// Send as server-sent event
						controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`));
					}

					// Send done event
					controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
				} catch (error: any) {
					// Send error event
					controller.enqueue(
						encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`)
					);
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
		console.error('Stream API error:', error);
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
