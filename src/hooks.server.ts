import { sequence } from '@sveltejs/kit/hooks';
import { handle as authHandle } from '$lib/auth/auth';
import { logEvent } from '$lib/services/ops-logger';

// Defensive guard for duplicate OAuth callback redemption.
// Microsoft auth codes are single-use; duplicate callback hits can trigger invalid_grant.
const seenOAuthCodes = new Map<string, number>();
const OAUTH_CODE_TTL_MS = 60_000;

const oauthDedupHandle = (async ({ event, resolve }) => {
	const pathname = event.url.pathname;
	if (pathname === '/auth/callback/microsoft-entra-id') {
		const code = event.url.searchParams.get('code');
		if (code) {
			const now = Date.now();
			// prune old entries
			for (const [k, ts] of seenOAuthCodes) {
				if (now - ts > OAUTH_CODE_TTL_MS) seenOAuthCodes.delete(k);
			}
			if (seenOAuthCodes.has(code)) {
				// swallow duplicate callback and return to app root
				return Response.redirect(new URL('/', event.url), 303);
			}
			seenOAuthCodes.set(code, now);
		}
	}
	return resolve(event);
}) satisfies import('@sveltejs/kit').Handle;

/** Ops event logging handle – runs after auth so session is available. */
const opsHandle = (async ({ event, resolve }) => {
	const pathname = event.url.pathname;

	// Skip auth callbacks and static assets — no logging needed
	if (pathname.startsWith('/auth') || pathname.startsWith('/_app') || pathname.startsWith('/favicon')) {
		return resolve(event);
	}

	// Grab session BEFORE resolve so cookies can still be set
	const session = await event.locals.auth();

	const start = performance.now();
	const response = await resolve(event);
	const duration = Math.round(performance.now() - start);

	const isApi = pathname.includes('/api/') || pathname.includes('/stream') || pathname.includes('/history') || pathname.endsWith('/ask');
	const eventType = isApi ? 'api_request' : 'page_view';

	logEvent({
		user_email: session?.user?.email ?? undefined,
		user_name: session?.user?.name ?? undefined,
		event_type: eventType,
		event_action: isApi ? event.request.method : 'navigate',
		route: pathname,
		metadata: {
			method: event.request.method,
			status: response.status,
		},
		duration_ms: duration,
	});

	return response;
}) satisfies import('@sveltejs/kit').Handle;

export const handle = sequence(oauthDedupHandle, authHandle, opsHandle);