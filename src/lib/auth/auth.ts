import {SvelteKitAuth} from '@auth/sveltekit';
import MicrosoftEntraID from '@auth/core/providers/microsoft-entra-id';
import { AUTH_MICROSOFT_ENTRA_ID_ID, AUTH_MICROSOFT_ENTRA_ID_SECRET, AUTH_MICROSOFT_ENTRA_ID_ISSUER } from '$env/static/private';

// TEMP: safe diagnostics (no full secret)
const clientIdLast4      = AUTH_MICROSOFT_ENTRA_ID_ID?.trim().slice(-4) || '****';
const clientIdLength     = AUTH_MICROSOFT_ENTRA_ID_ID?.trim().length    || 0;
const last4Secret        = AUTH_MICROSOFT_ENTRA_ID_SECRET?.trim().slice(-4) || '****';
const callbackHost = () => process.env.VERCEL_URL || process.env.AUTH_URL || (process.env.HOST ? `https://${process.env.HOST}` : 'unknown');

console.log('[AUTH][CHECK] clientId-last-4', clientIdLast4, 'len', clientIdLength);
console.log('[AUTH][CHECK] secret-last-4', last4Secret);
console.log('[AUTH][CHECK] ENV host', callbackHost());

// End temp diagnostics

export const {handle} = SvelteKitAuth({
    providers: [
        MicrosoftEntraID({
            clientId: AUTH_MICROSOFT_ENTRA_ID_ID,
            clientSecret: AUTH_MICROSOFT_ENTRA_ID_SECRET,
            issuer: AUTH_MICROSOFT_ENTRA_ID_ISSUER,
            authorization: {
                params: {
                    scope: 'openid profile email offline_access Calendars.ReadWrite User.Read.All',
                },
            },
        }),
    ],
    callbacks: {
        async jwt({ token, account }) {
            // Persist the OAuth access_token to the token right after signin
            if (account) {
                token.accessToken = account.access_token;
                token.refreshToken = account.refresh_token;
                token.accessTokenExpires = account.expires_at;
            }
            return token;
        },
        async session({ session, token }) {
            // Send properties to the client
            (session as any).accessToken = token.accessToken;
            return session;
        },
    },
    debug: true,
    logger: {
        error(code, metadata) {
            console.error('[AUTH][ERROR]', code, metadata);
        },
        warn(code) {
            console.warn('[AUTH][WARN]', code);
        },
        debug(code, metadata) {
            console.log('[AUTH][DEBUG]', code, metadata);
        },
    },
    trustHost: true,
});