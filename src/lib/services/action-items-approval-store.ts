type RawActionItem = Record<string, unknown> | string;

export type ActionItem = {
	title: string;
	owner?: string;
	goal?: string;
};

export type ActionItemsApproval = {
	workflowExecutionId: string;
	actionItems: ActionItem[];
	goal?: string;
	createdAt: number;
};

const approvals = new Map<string, ActionItemsApproval>();
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const toStringOrEmpty = (value: unknown) =>
	typeof value === 'string' && value.trim() ? value.trim() : undefined;

const normalizeActionItem = (item: RawActionItem): ActionItem => {
	if (typeof item === 'string') {
		return { title: item };
	}

	const title =
		toStringOrEmpty(item.title) ??
		toStringOrEmpty(item.task) ??
		toStringOrEmpty(item.name) ??
		toStringOrEmpty(item.description) ??
		'Untitled action item';

	const owner =
		toStringOrEmpty(item.owner) ??
		toStringOrEmpty(item.assignee) ??
		toStringOrEmpty(item.assigned_to);

	const goal =
		toStringOrEmpty(item.goal) ??
		toStringOrEmpty(item.objective) ??
		toStringOrEmpty(item.outcome);

	return { title, owner, goal };
};

const pruneExpired = () => {
	const now = Date.now();
	for (const [id, approval] of approvals.entries()) {
		if (now - approval.createdAt > MAX_AGE_MS) {
			approvals.delete(id);
		}
	}
};

export const setApproval = (
	workflowExecutionId: string,
	rawItems: RawActionItem[],
	goal?: string
): ActionItemsApproval => {
	pruneExpired();
	const actionItems = rawItems.map(normalizeActionItem);
	const approval: ActionItemsApproval = {
		workflowExecutionId,
		actionItems,
		goal,
		createdAt: Date.now(),
	};
	approvals.set(workflowExecutionId, approval);
	return approval;
};

export const getApproval = (workflowExecutionId: string) => {
	pruneExpired();
	return approvals.get(workflowExecutionId) ?? null;
};

export const deleteApproval = (workflowExecutionId: string) => {
	approvals.delete(workflowExecutionId);
};
