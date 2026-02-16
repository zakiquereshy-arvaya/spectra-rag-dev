import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createApproval } from '$lib/services/action-items-approval-api';

export const POST: RequestHandler = async (event) => {
	let payload: {
		action_items?: unknown;
		workflow_execution_id?: string;
		goal?: string;
	} | null = null;

	try {
		payload = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const created = createApproval(payload);
	if (!created.ok) {
		return json({ error: created.error }, { status: created.status });
	}

	const approvalUrl = new URL('/action-items/approval', event.url);
	approvalUrl.searchParams.set('workflow_execution_id', created.workflowExecutionId);

	return json({
		ok: true,
		workflow_execution_id: created.workflowExecutionId,
		approval_url: approvalUrl.toString(),
	});
};
