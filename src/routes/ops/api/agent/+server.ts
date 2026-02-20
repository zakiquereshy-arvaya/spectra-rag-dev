import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isOpsAllowed } from '$lib/services/ops-access';
import { queryAgentReports } from '$lib/services/ops-logger';
import { DevOpsAgentService } from '$lib/services/devops-agent';
import { env } from '$env/dynamic/private';

/** GET: Fetch recent agent reports */
export const GET: RequestHandler = async (event) => {
	const session = await event.locals.auth();
	if (!session || !isOpsAllowed(session.user?.email)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	try {
		const limit = parseInt(event.url.searchParams.get('limit') ?? '10');
		const data = await queryAgentReports(limit);
		return json({ data });
	} catch (error: any) {
		console.error('[Ops Agent API] GET error:', error);
		return json({ error: error.message }, { status: 500 });
	}
};

/** POST: Trigger a new assessment */
export const POST: RequestHandler = async (event) => {
	const session = await event.locals.auth();
	if (!session || !isOpsAllowed(session.user?.email)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	if (!env.OPENAI_API_KEY) {
		return json({ error: 'OpenAI API key not configured' }, { status: 500 });
	}

	try {
		const agent = new DevOpsAgentService(env.OPENAI_API_KEY);
		const report = await agent.runAssessment(session.user?.email ?? 'unknown');
		return json({ data: report });
	} catch (error: any) {
		console.error('[Ops Agent API] POST error:', error);
		return json({ error: error.message }, { status: 500 });
	}
};
