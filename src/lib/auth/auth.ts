import {SvelteKitAuth} from '@auth/sveltekit';
import MicrosoftEntraID from '@auth/core/providers/microsoft-entra-id';
import { env } from '$env/dynamic/private';
import { createHash } from 'node:crypto';

const clientId = (env.AUTH_MICROSOFT_ENTRA_ID_ID ?? '').trim();
const clientSecret = (env.AUTH_MICROSOFT_ENTRA_ID_SECRET ?? '').trim();
const issuer = (env.AUTH_MICROSOFT_ENTRA_ID_ISSUER ?? '').trim();
const CALLBACK_PATH = '/auth/callback/microsoft-entra-id';
const CALLBACK_DEDUPE_TTL_MS = 60_000;
const recentCallbackCodeHashes = new Map<string, number>();

const { handle: authHandle } = SvelteKitAuth({
    providers: [
        MicrosoftEntraID({
            clientId,
            clientSecret,
            issuer,
            checks: ['pkce', 'state'],
            client: {
                token_endpoint_auth_method: 'client_secret_post',
            },
            authorization: {
                params: {
                    scope: 'openid profile email offline_access Calendars.ReadWrite User.Read.All',
                },
            },
        }),
    ],
    callbacks: {
        async jwt({ token, account }) {
            if (account) {
                token.accessToken = account.access_token;
                token.refreshToken = account.refresh_token;
                token.accessTokenExpires = account.expires_at;
            }
            return token;
        },
        async session({ session, token }) {
            (session as any).accessToken = token.accessToken;
            return session;
        },
    },
    trustHost: true,
});

const isAuthDebugEnabled = env.AUTH_DEBUG?.trim() === 'true';

function shortHash(value: string | null): string | null {
    if (!value) return null;
    return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function pruneOldCallbackHashes(now: number): void {
    for (const [hash, seenAt] of recentCallbackCodeHashes.entries()) {
        if (now - seenAt > CALLBACK_DEDUPE_TTL_MS) {
            recentCallbackCodeHashes.delete(hash);
        }
    }
}

function redirectToHome(origin: string): Response {
    return new Response(null, {
        status: 302,
        headers: { location: `${origin}/` },
    });
}

function serializeError(error: unknown): Record<string, unknown> {
    if (!(error instanceof Error)) {
        return { raw: String(error) };
    }

    const maybeCause = (error as Error & { cause?: unknown }).cause;
    return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause: maybeCause,
    };
}

export const handle: import('@sveltejs/kit').Handle = async ({ event, resolve }) => {
    const isCallbackRequest = event.url.pathname === CALLBACK_PATH;
    const code = event.url.searchParams.get('code');
    const codeHash = shortHash(code);

    if (isCallbackRequest && codeHash) {
        const now = Date.now();
        pruneOldCallbackHashes(now);

        const hasSeenCodeRecently = recentCallbackCodeHashes.has(codeHash);
        if (hasSeenCodeRecently) {
            console.error('[AuthTrace] callback_dedupe', {
                codeHash,
                host: event.url.host,
                protocol: event.url.protocol,
            });
            return redirectToHome(event.url.origin);
        }

        recentCallbackCodeHashes.set(codeHash, now);
    }

    if (!isAuthDebugEnabled || !isCallbackRequest) {
        return authHandle({ event, resolve });
    }

    const cookieHeader = event.request.headers.get('cookie') ?? '';
    const hasSecurePkceCookie = /(?:^|;\s*)__Secure-authjs\.pkce\.code_verifier=/.test(cookieHeader);
    const hasPlainPkceCookie = /(?:^|;\s*)authjs\.pkce\.code_verifier=/.test(cookieHeader);
    const state = event.url.searchParams.get('state');
    const sessionState = event.url.searchParams.get('session_state');
    const traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    console.error('[AuthTrace] callback_in', {
        traceId,
        method: event.request.method,
        host: event.url.host,
        protocol: event.url.protocol,
        codePresent: Boolean(code),
        codeHash,
        statePresent: Boolean(state),
        stateHash: shortHash(state),
        sessionStatePresent: Boolean(sessionState),
        sessionStateHash: shortHash(sessionState),
        hasSecurePkceCookie,
        hasPlainPkceCookie,
        cookieCount: cookieHeader ? cookieHeader.split(';').length : 0,
        xForwardedHost: event.request.headers.get('x-forwarded-host'),
        xForwardedProto: event.request.headers.get('x-forwarded-proto'),
    });

    try {
        const response = await authHandle({ event, resolve });
        console.error('[AuthTrace] callback_out', {
            traceId,
            status: response.status,
            location: response.headers.get('location'),
        });
        return response;
    } catch (error) {
        console.error('[AuthTrace] callback_throw', {
            traceId,
            error: serializeError(error),
        });
        throw error;
    }
};