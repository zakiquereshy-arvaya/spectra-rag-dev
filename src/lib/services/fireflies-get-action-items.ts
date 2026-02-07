import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FIREFLIES_API_ENDPOINT = 'https://api.fireflies.ai/graphql';

const DEFAULT_TRANSCRIPT_ID = '01KGHRW48MYSBDX0G80WT0NNXF';

const TRANSCRIPT_QUERY = `
	query Transcript($transcriptId: String!) {
		transcript(id: $transcriptId) {
			id
			title
			summary {
				action_items
			}
		}
	}
`;

type FirefliesTranscript = {
	id: string;
	title: string;
	summary?: {
		action_items?: unknown;
	};
};

type FirefliesTranscriptResponse = {
	transcript: FirefliesTranscript | null;
};

const loadEnvFromFile = () => {
	const envPath = path.resolve(process.cwd(), '.env');
	if (!fs.existsSync(envPath)) {
		return;
	}
	const contents = fs.readFileSync(envPath, 'utf8');
	for (const line of contents.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eqIndex = trimmed.indexOf('=');
		if (eqIndex === -1) continue;
		const key = trimmed.slice(0, eqIndex).trim();
		const rawValue = trimmed.slice(eqIndex + 1).trim();
		const value = rawValue.replace(/^['"]|['"]$/g, '');
		if (key && process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
};

const getApiKey = () => {
	if (!process.env.FF_API_KEY) {
		loadEnvFromFile();
	}
	const apiKey = process.env.FF_API_KEY?.trim().replace(/^['"]|['"]$/g, '');
	if (!apiKey) {
		throw new Error('Fireflies API key is required. Set FF_API_KEY environment variable.');
	}
	return apiKey;
};

const getApprovalUrl = () => {
	const configured = process.env.ACTION_ITEMS_APPROVAL_URL?.trim();
	if (configured) {
		return configured;
	}
	return 'http://localhost:5173/action-items/approval';
};

export const fetchFirefliesTranscript = async (
	transcriptId: string = DEFAULT_TRANSCRIPT_ID
) => {
	const response = await fetch(FIREFLIES_API_ENDPOINT, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-apollo-operation-name': 'Transcript',
			'apollo-require-preflight': 'true',
			Authorization: `Bearer ${getApiKey()}`,
		},
		body: JSON.stringify({
			query: TRANSCRIPT_QUERY,
			variables: { transcriptId },
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Fireflies API HTTP error (${response.status}): ${errorText || response.statusText}`
		);
	}

	const result: { data?: FirefliesTranscriptResponse; errors?: Array<{ message: string }> } =
		await response.json();

	if (result.errors?.length) {
		const message = result.errors.map((error) => error.message).join('; ');
		throw new Error(`Fireflies GraphQL error: ${message}`);
	}

	if (!result.data?.transcript) {
		throw new Error('Fireflies API returned no transcript data');
	}

	return result.data.transcript;
};

type ApprovalResponse = {
	ok?: boolean;
	workflow_execution_id?: string;
	approval_url?: string;
	[key: string]: unknown;
};

export const submitForApproval = async (
	actionItems: unknown[],
	options?: { workflowExecutionId?: string }
) => {
	const workflowExecutionId = options?.workflowExecutionId ?? crypto.randomUUID();
	const response = await fetch(getApprovalUrl(), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			action_items: actionItems,
			workflow_execution_id: workflowExecutionId,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Approval API HTTP error (${response.status}): ${errorText || response.statusText}`
		);
	}

	const result: ApprovalResponse = await response.json();
	return result;
};

export const runFirefliesActionItems = async (
	transcriptId: string = DEFAULT_TRANSCRIPT_ID,
	options?: { maxItems?: number; workflowExecutionId?: string }
) => {
	const transcript = await fetchFirefliesTranscript(transcriptId);
	const rawActionItems = transcript.summary?.action_items;
	const actionItems = Array.isArray(rawActionItems)
		? rawActionItems
		: typeof rawActionItems === 'string'
			? rawActionItems
					.split(/\r?\n/)
					.map((item) => item.replace(/^[-*]\s+/, '').trim())
					.filter(Boolean)
			: [];

	if (actionItems.length === 0) {
		throw new Error(
			`No Fireflies action items found for transcript ${transcriptId}. ` +
				`Summary action_items value: ${JSON.stringify(rawActionItems)}`
		);
	}

	const limitedActionItems =
		options?.maxItems && options.maxItems > 0
			? actionItems.slice(0, options.maxItems)
			: actionItems;

	const approvalPayload = buildApprovalItems(limitedActionItems);
	const approvalResult = await submitForApproval(approvalPayload, {
		workflowExecutionId: options?.workflowExecutionId,
	});

	return { actionItems: approvalPayload, approvalResult };
};

const buildApprovalItems = (items: string[]): unknown[] => {
	let currentOwner: string | undefined;

	const isOwnerMarker = (value: string) => {
		const boldMatch = value.match(/^\*\*(.+)\*\*$/);
		if (boldMatch?.[1]) {
			return boldMatch[1].trim();
		}
		if (value.endsWith(':') && value.length <= 60) {
			return value.slice(0, -1).trim();
		}
		return null;
	};

	const parseInlineOwner = (value: string) => {
		const separators = [' - ', ' — ', ' – '];
		for (const separator of separators) {
			const parts = value.split(separator);
			if (parts.length >= 2) {
				const owner = parts[0].trim();
				const title = parts.slice(1).join(separator).trim();
				if (owner && title) {
					return { owner, title };
				}
			}
		}
		return null;
	};

	const normalized = [];
	for (const rawItem of items) {
		const cleaned = rawItem.trim();
		if (!cleaned) continue;

		const ownerMarker = isOwnerMarker(cleaned);
		if (ownerMarker) {
			currentOwner = ownerMarker;
			continue;
		}

		const inline = parseInlineOwner(cleaned);
		if (inline) {
			normalized.push({ title: inline.title, owner: inline.owner });
			continue;
		}

		normalized.push({ title: cleaned, owner: currentOwner });
	}

	return normalized.length > 0 ? normalized : items;
};

if (typeof process !== 'undefined' && process.argv[1]?.includes('fireflies-get-action-items')) {
	const [, , transcriptIdArg, maxItemsArg, workflowExecutionIdArg] = process.argv;
	const maxItems = maxItemsArg ? Number(maxItemsArg) : undefined;
	runFirefliesActionItems(transcriptIdArg || DEFAULT_TRANSCRIPT_ID, {
		maxItems: Number.isFinite(maxItems) ? maxItems : undefined,
		workflowExecutionId: workflowExecutionIdArg || undefined,
	})
		.then((result) => {
			console.log(JSON.stringify(result, null, 2));
		})
		.catch((error) => {
			console.error(error);
			process.exitCode = 1;
		});
}
