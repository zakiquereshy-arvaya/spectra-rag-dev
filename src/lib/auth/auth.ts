import {SvelteKitAuth} from '@auth/sveltekit';
import MicrosoftEntraID from '@auth/core/providers/microsoft-entra-id';
import { AUTH_MICROSOFT_ENTRA_ID_ID, AUTH_MICROSOFT_ENTRA_ID_SECRET, AUTH_MICROSOFT_ENTRA_ID_ISSUER } from '$env/static/private';

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
    trustHost: true,
});