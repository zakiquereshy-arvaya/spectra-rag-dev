// Microsoft Graph App-Only Authentication Service (Client Credentials Flow)

const TOKEN_CACHE = new Map<string, { token: string; expiresAt: number }>();

export class MicrosoftGraphAuth {
	private tenantId: string;
	private clientId: string;
	private clientSecret: string;
	private tokenUrl: string;
	private scope: string;

	constructor(tenantId: string, clientId: string, clientSecret: string) {
		this.tenantId = tenantId;
		this.clientId = clientId;
		this.clientSecret = clientSecret;
		this.tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
		this.scope = 'https://graph.microsoft.com/.default';
	}

	/**
	 * Get app-only access token using client credentials flow
	 * Caches tokens until they expire
	 */
	async getAccessToken(): Promise<string> {
		const cacheKey = `${this.tenantId}-${this.clientId}`;
		const cached = TOKEN_CACHE.get(cacheKey);

		// Return cached token if still valid (with 5 minute buffer)
		if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
			return cached.token;
		}

		try {
			const response = await fetch(this.tokenUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({
					client_id: this.clientId,
					client_secret: this.clientSecret,
					scope: this.scope,
					grant_type: 'client_credentials',
				}),
			});

			if (!response.ok) {
				const errorText = await response.text();
				let error: any;
				try {
					error = JSON.parse(errorText);
				} catch {
					error = { error_description: errorText || response.statusText };
				}
				throw new Error(
					`Failed to get app-only token: ${response.status} - ${error.error_description || error.error || errorText}`
				);
			}

			const data = await response.json();
			const expiresIn = data.expires_in || 3600; // Default to 1 hour
			const expiresAt = Date.now() + expiresIn * 1000;

			// Cache the token
			TOKEN_CACHE.set(cacheKey, {
				token: data.access_token,
				expiresAt,
			});

			return data.access_token;
		} catch (error: any) {
			throw new Error(`Microsoft Graph authentication error: ${error.message}`);
		}
	}

	/**
	 * Clear cached token (useful for testing or forced refresh)
	 */
	static clearCache(): void {
		TOKEN_CACHE.clear();
	}
}
