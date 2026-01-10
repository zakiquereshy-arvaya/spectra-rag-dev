// Auth utility functions

import type { Session } from '@auth/core/types';

/**
 * Get Microsoft Graph access token from session
 */
export function getAccessToken(session: Session | null): string | null {
	if (!session) {
		return null;
	}

	// The access token should be available in the session after auth callback
	return (session as any).accessToken || null;
}

/**
 * Check if session has valid access token
 */
export function hasValidAccessToken(session: Session | null): boolean {
	const token = getAccessToken(session);
	return !!token;
}
