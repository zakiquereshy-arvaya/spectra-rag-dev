import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isOpsAllowed } from '$lib/services/ops-access';
import { queryRagMetrics } from '$lib/services/ops-logger';

export const GET: RequestHandler = async (event) => {
	const session = await event.locals.auth();
	if (!session || !isOpsAllowed(session.user?.email)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	try {
		const url = event.url;
		const data = await queryRagMetrics({
			limit: parseInt(url.searchParams.get('limit') ?? '100'),
			from: url.searchParams.get('from') ?? undefined,
			to: url.searchParams.get('to') ?? undefined,
		});

		return json({ data });
	} catch (error: any) {
		console.error('[Ops RAG Metrics API]', error);
		return json({ error: error.message }, { status: 500 });
	}
};
