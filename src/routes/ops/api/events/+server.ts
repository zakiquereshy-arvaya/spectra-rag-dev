import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isOpsAllowed } from '$lib/services/ops-access';
import { queryEvents, queryEventStats } from '$lib/services/ops-logger';

export const GET: RequestHandler = async (event) => {
	const session = await event.locals.auth();
	if (!session || !isOpsAllowed(session.user?.email)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const url = event.url;
	const mode = url.searchParams.get('mode') ?? 'list';

	try {
		if (mode === 'stats') {
			const from = url.searchParams.get('from') ?? undefined;
			const to = url.searchParams.get('to') ?? undefined;
			const data = await queryEventStats(from, to);
			return json({ data });
		}

		const data = await queryEvents({
			limit: parseInt(url.searchParams.get('limit') ?? '50'),
			offset: parseInt(url.searchParams.get('offset') ?? '0'),
			user_email: url.searchParams.get('user_email') ?? undefined,
			event_type: url.searchParams.get('event_type') ?? undefined,
			route: url.searchParams.get('route') ?? undefined,
			from: url.searchParams.get('from') ?? undefined,
			to: url.searchParams.get('to') ?? undefined,
		});

		return json({ data });
	} catch (error: any) {
		console.error('[Ops Events API]', error);
		return json({ error: error.message }, { status: 500 });
	}
};
