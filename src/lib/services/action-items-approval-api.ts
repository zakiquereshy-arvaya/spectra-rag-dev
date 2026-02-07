import { setApproval } from './action-items-approval-store';

export type ApprovalPayload = {
	action_items?: unknown;
	workflow_execution_id?: string;
	goal?: string;
};

type ApprovalValidationResult =
	| {
			ok: true;
			workflowExecutionId: string;
			actionItems: unknown[];
			goal?: string;
	  }
	| {
			ok: false;
			status: number;
			error: string;
	  };

export const validateApprovalPayload = (
	payload: ApprovalPayload | null
): ApprovalValidationResult => {
	const actionItems = Array.isArray(payload?.action_items) ? payload?.action_items : null;
	const workflowExecutionId = payload?.workflow_execution_id?.toString().trim();
	const goal = payload?.goal?.toString().trim();

	if (!workflowExecutionId) {
		return { ok: false, status: 400, error: 'workflow_execution_id is required' };
	}

	if (!actionItems || actionItems.length === 0) {
		return { ok: false, status: 400, error: 'action_items array is required' };
	}

	return {
		ok: true,
		workflowExecutionId,
		actionItems,
		goal,
	};
};

export const createApproval = (payload: ApprovalPayload | null) => {
	const validation = validateApprovalPayload(payload);
	if (!validation.ok) {
		return validation;
	}

	setApproval(validation.workflowExecutionId, validation.actionItems, validation.goal);
	return validation;
};
