import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MCPServer } from '$lib/services/mcp-server';
import { MicrosoftGraphAuth } from '$lib/services/microsoft-graph-auth';
import { getAccessToken } from '$lib/utils/auth';
import { PUBLIC_COHERE_API_KEY } from '$env/static/public';
import { 
	AUTH_MICROSOFT_ENTRA_ID_ID, 
	AUTH_MICROSOFT_ENTRA_ID_SECRET, 
	AUTH_MICROSOFT_ENTRA_ID_ISSUER, 
	AUTH_MICROSOFT_ENTRA_ID_TENANT_ID 
} from '$env/static/private';
import type { MCPRequest } from '$lib/types/mcp';

export const POST: RequestHandler = async (event) => {
	const session = await event.locals.auth();
	
	if (!session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// Get Cohere API key from environment (try public first, then private)
	const cohereApiKey = PUBLIC_COHERE_API_KEY;
	if (!cohereApiKey) {
		return json(
			{ error: 'Cohere API key not configured. Please set PUBLIC_COHERE_API_KEY environment variable.' },
			{ status: 500 }
		);
	}

	// Get Microsoft Graph app-only auth credentials (client credentials flow)
	// Extract tenant ID from issuer if not explicitly set
	// Issuer format: https://login.microsoftonline.com/{tenantId}/v2.0
	const issuer = AUTH_MICROSOFT_ENTRA_ID_ISSUER || '';
	const tenantId = AUTH_MICROSOFT_ENTRA_ID_TENANT_ID || 
		(issuer ? issuer.split('/')[3] : null);
	const clientId = AUTH_MICROSOFT_ENTRA_ID_ID;
	const clientSecret = AUTH_MICROSOFT_ENTRA_ID_SECRET;

	if (!tenantId || !clientId || !clientSecret) {
		console.error('Missing Microsoft Graph app-only auth config:', {
			hasTenantId: !!tenantId,
			hasClientId: !!clientId,
			hasClientSecret: !!clientSecret,
			issuer,
		});
		return json(
			{ error: 'Microsoft Graph app-only authentication not configured. Please set AUTH_MICROSOFT_ENTRA_ID_TENANT_ID (or ensure AUTH_MICROSOFT_ENTRA_ID_ISSUER is set), AUTH_MICROSOFT_ENTRA_ID_ID, and AUTH_MICROSOFT_ENTRA_ID_SECRET environment variables.' },
			{ status: 500 }
		);
	}

	// Create app-only auth service (client credentials flow)
	const authService = new MicrosoftGraphAuth(tenantId, clientId, clientSecret);

	// Get delegated access token as fallback (for user's own calendar operations if needed)
	const accessToken = getAccessToken(session);

	let requestId: string | number | null = null;
	
	try {
		const body = await event.request.json();
		const mcpRequest = body as MCPRequest & { params?: { message?: string; sessionId?: string } };
		requestId = mcpRequest.id;

		// Get session ID from request params or generate one
		const sessionId = mcpRequest.params?.sessionId || 'default';

		console.log('MCP Request received:', {
			method: mcpRequest.method,
			hasParams: !!mcpRequest.params,
			sessionId,
			hasAuthService: !!authService,
			hasAccessToken: !!accessToken,
			hasCohereKey: !!cohereApiKey,
		});

		// Get logged-in user information from session
		const loggedInUser = session.user ? {
			name: session.user.name || session.user.email || 'Unknown User',
			email: session.user.email || (session.user as any).userPrincipalName || ''
		} : null;

		if (!loggedInUser || !loggedInUser.email) {
			return json(
				{ error: 'Unable to determine logged-in user. Please ensure you are properly authenticated.' },
				{ status: 401 }
			);
		}

		// Create MCP server instance with app-only auth (client credentials)
		// This allows access to all users' calendars, not just the logged-in user
		const mcpServer = new MCPServer(cohereApiKey, sessionId, authService, accessToken || undefined, loggedInUser);

		// Handle the request
		const response = await mcpServer.handleRequest(mcpRequest);

		console.log('MCP Response:', {
			hasError: !!response.error,
			hasResult: !!response.result,
		});

		return json(response);
	} catch (error: any) {
		console.error('MCP API error:', {
			message: error.message,
			stack: error.stack,
			name: error.name,
		});
		return json(
			{
				jsonrpc: '2.0',
				id: requestId || null,
				error: {
					code: -32603,
					message: error.message || 'Internal error',
				},
			},
			{ status: 500 }
		);
	}
};
