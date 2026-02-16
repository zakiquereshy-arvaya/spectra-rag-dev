import { fail, json, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	deleteApproval,
	getApproval,
	type ActionItem,
} from '$lib/services/action-items-approval-store';
import { createApproval } from '$lib/services/action-items-approval-api';
import { env } from '$env/dynamic/private';

const buildApprovedItems = (items: ActionItem[], formData: FormData) =>
	items.map((item, index) => {
		const status = formData.get(`status-${index}`)?.toString() ?? 'approved';
		return {
			title: item.title,
			owner: item.owner ?? '',
			status: status === 'rejected' ? 'rejected' : 'approved',
		};
	});

export const load: PageServerLoad = ({ url }) => {
	const workflowExecutionId = url.searchParams.get('workflow_execution_id')?.trim() || null;
	const submitted = url.searchParams.get('submitted') === '1';

	if (!workflowExecutionId) {
		return {
			workflowExecutionId: null,
			actionItems: [],
			goal: null,
			submitted,
			notFound: false,
		};
	}

	const approval = getApproval(workflowExecutionId);

	return {
		workflowExecutionId,
		actionItems: approval?.actionItems ?? [],
		goal: approval?.goal ?? null,
		submitted,
		notFound: !approval,
	};
};

export const actions: Actions = {
	default: async (event) => {
		const contentType = event.request.headers.get('content-type') ?? '';
		if (contentType.includes('application/json')) {
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
		}

		const formData = await event.request.formData();
		const workflowExecutionId = formData.get('workflow_execution_id')?.toString().trim();

		if (!workflowExecutionId) {
			return fail(400, { error: 'Missing workflow execution id.' });
		}

		const approval = getApproval(workflowExecutionId);

		if (!approval) {
			return fail(404, { error: 'Approval request not found or expired.' });
		}

		const webhookUrl = env.N8N_INGESTION_URL ?? env.ACTION_ITEMS_APPROVAL_WEBHOOK_URL;
		if (!webhookUrl) {
			return fail(500, { error: 'Approval webhook URL is not configured.' });
		}

		const approvedItems = buildApprovedItems(approval.actionItems, formData);

		const response = await event.fetch(webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ approved_items: approvedItems }),
		});

		if (!response.ok) {
			const body = await response.text();
			return fail(502, {
				error: `Webhook request failed (${response.status}). ${body || 'No response body.'}`,
			});
		}

		deleteApproval(workflowExecutionId);

		const successUrl = new URL(event.url);
		successUrl.searchParams.set('workflow_execution_id', workflowExecutionId);
		successUrl.searchParams.set('submitted', '1');
		throw redirect(303, successUrl.toString());
	},
};
