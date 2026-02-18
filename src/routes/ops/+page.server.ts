import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isOpsAllowed } from '$lib/services/ops-access';

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();

	if (!session) {
		throw redirect(302, '/');
	}

	const email = session.user?.email ?? null;
	if (!isOpsAllowed(email)) {
		throw redirect(302, '/moe');
	}

	return {
		session,
	};
};
