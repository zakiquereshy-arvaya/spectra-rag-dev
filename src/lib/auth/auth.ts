import {SvelteKitAuth} from '@auth/sveltekit';
import MicrosoftEntraID from '@auth/core/providers/microsoft-entra-id';
import { AUTH_MICROSOFT_ENTRA_ID_ID, AUTH_MICROSOFT_ENTRA_ID_SECRET, AUTH_MICROSOFT_ENTRA_ID_ISSUER } from '$env/static/private';
import { env } from '$env/dynamic/private';
import { createHash } from 'node:crypto';

const clientId = AUTH_MICROSOFT_ENTRA_ID_ID.trim();
const clientSecret = AUTH_MICROSOFT_ENTRA_ID_SECRET.trim();
const issuer = AUTH_MICROSOFT_ENTRA_ID_ISSUER.trim();

const { handle: authHandle } = SvelteKitAuth({
    providers: [
        MicrosoftEntraID({
            clientId,
            clientSecret,
            issuer,
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

const CALLBACK_PATH = '/auth/callback/microsoft-entra-id';
const isAuthDebugEnabled = env.AUTH_DEBUG?.trim() === 'true';

function shortHash(value: string | null): string | null {
    if (!value) return null;
    return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export const handle: import('@sveltejs/kit').Handle = async ({ event, resolve }) => {
    const isCallbackRequest = event.url.pathname === CALLBACK_PATH;

    if (!isAuthDebugEnabled || !isCallbackRequest) {
        return authHandle({ event, resolve });
    }

    const cookieHeader = event.request.headers.get('cookie') ?? '';
    const hasSecurePkceCookie = /(?:^|;\s*)__Secure-authjs\.pkce\.code_verifier=/.test(cookieHeader);
    const hasPlainPkceCookie = /(?:^|;\s*)authjs\.pkce\.code_verifier=/.test(cookieHeader);
    const code = event.url.searchParams.get('code');
    const state = event.url.searchParams.get('state');
    const sessionState = event.url.searchParams.get('session_state');
    const traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    console.error('[AuthTrace] callback_in', {
        traceId,
        method: event.request.method,
        host: event.url.host,
        protocol: event.url.protocol,
        codePresent: Boolean(code),
        codeHash: shortHash(code),
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
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
};