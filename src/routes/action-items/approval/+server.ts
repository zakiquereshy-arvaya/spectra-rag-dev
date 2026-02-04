import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setApproval } from '$lib/services/action-items-approval-store';

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

	const actionItems = Array.isArray(payload?.action_items) ? payload?.action_items : null;
	const workflowExecutionId = payload?.workflow_execution_id?.toString().trim();
	const goal = payload?.goal?.toString().trim();

	if (!workflowExecutionId) {
		return json({ error: 'workflow_execution_id is required' }, { status: 400 });
	}

	if (!actionItems || actionItems.length === 0) {
		return json({ error: 'action_items array is required' }, { status: 400 });
	}

	setApproval(workflowExecutionId, actionItems, goal);

	const approvalUrl = new URL('/action-items/approval', event.url);
	approvalUrl.searchParams.set('workflow_execution_id', workflowExecutionId);

	return json({
		ok: true,
		workflow_execution_id: workflowExecutionId,
		approval_url: approvalUrl.toString(),
	});
};
