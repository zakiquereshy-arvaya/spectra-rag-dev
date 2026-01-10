import {SvelteKitAuth} from '@auth/sveltekit';
import MicrosoftEntraID from '@auth/core/providers/microsoft-entra-id';

export const {handle} = SvelteKitAuth({
    providers: [
        MicrosoftEntraID({
            clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
            clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
            issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
        }),
    ],
    trustHost: true,
});