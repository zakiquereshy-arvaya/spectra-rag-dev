// Time Entry Form Submission Endpoint
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import OpenAI from 'openai';
import { env } from '$env/dynamic/private';
import { getEmployeeByName, getCustomerByName, getAllEmployees, type Employee } from '$lib/services/azero-db';
import { getTodayEastern } from '$lib/utils/datetime';

export interface TimeEntryFormData {
	customer: string;
	project: string;
	description: string;
	hours: number;
	userName: string;
	userEmail: string;
	entryDate: string;
	testEmployeeName?: string;
	testEmployeeEmail?: string;
}

function isPlaceholderIdentity(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	if (!normalized) return true;
	return /^(unknown\b|placeholder\b|test\b|user\b|employee\b|n\/?a$)/i.test(normalized);
}

function scoreEmployeeCandidate(candidate: Employee, userName: string, userEmail: string): number {
	const name = userName.trim().toLowerCase();
	const email = userEmail.trim().toLowerCase();
	const candidateName = candidate.name.toLowerCase();
	const candidateEmail = candidate.email.toLowerCase();

	let score = 0;
	if (email && candidateEmail === email) score += 100;
	if (email && candidateEmail.includes(email)) score += 40;
	if (name && candidateName === name) score += 70;
	if (name && candidateName.includes(name)) score += 35;
	if (name) {
		const parts = name.split(/\s+/).filter(Boolean);
		if (parts.length >= 2 && parts.every((p) => candidateName.includes(p))) {
			score += 25;
		}
	}
	return score;
}

async function resolveEmployeeForWebhook(userName: string, userEmail: string): Promise<Employee | null> {
	const allEmployees = await getAllEmployees();
	if (allEmployees.length === 0) return null;

	const normalizedEmail = userEmail.trim().toLowerCase();
	if (normalizedEmail) {
		const byEmail = allEmployees.find((e) => e.email.toLowerCase() === normalizedEmail);
		if (byEmail) return byEmail;
	}

	if (!isPlaceholderIdentity(userName)) {
		const byName = await getEmployeeByName(userName);
		if (byName) return byName;
	}

	if (!env.OPENAI_API_KEY) {
		return null;
	}

	const ranked = [...allEmployees]
		.map((employee) => ({ employee, score: scoreEmployeeCandidate(employee, userName, userEmail) }))
		.sort((a, b) => b.score - a.score)
		.slice(0, 25)
		.map((item) => item.employee);

	const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
	const response = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		temperature: 0,
		messages: [
			{
				role: 'system',
				content:
					'You map a user identity to the correct employee row for time-entry posting. Return ONLY strict JSON.',
			},
			{
				role: 'user',
				content: `Session identity:
- user_name: ${userName || '(empty)'}
- user_email: ${userEmail || '(empty)'}

Candidate employees (id, name, email, qbo_id):
${JSON.stringify(
	ranked.map((e) => ({ id: e.id, name: e.name, email: e.email, qbo_id: e.qbo_id })),
	null,
	2
)}

Return JSON:
{"employee_id": number|null, "confidence": "high|medium|low", "reason": "short reason"}

Rules:
- Pick only one employee_id from the candidate list.
- Use email match as strongest signal.
- If uncertain, return employee_id as null.`,
			},
		],
	});

	let text = response.choices[0]?.message?.content?.trim() || '';
	if (text.startsWith('```')) {
		const pieces = text.split('```');
		if (pieces.length > 1) {
			text = pieces[1].replace(/^json/i, '').trim();
		}
	}
	try {
		const parsed = JSON.parse(text) as { employee_id?: number | string | null };
		const selectedId =
			typeof parsed.employee_id === 'string' ? Number.parseInt(parsed.employee_id, 10) : parsed.employee_id;
		if (!selectedId) return null;
		return ranked.find((e) => e.id === selectedId) || null;
	} catch {
		console.warn('[TimeEntry] Failed to parse LLM employee resolution response');
		return null;
	}
}

export const POST: RequestHandler = async (event) => {
	const session = await event.locals.auth();

	if (!session) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	if (!env.BILLI_DEV_WEBHOOK_URL) {
		console.error('[TimeEntry] BILLI_DEV_WEBHOOK_URL not configured');
		return new Response(JSON.stringify({ error: 'Webhook URL not configured' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const body = await event.request.json();
		const {
			customer,
			project,
			description,
			hours,
			entryDate,
			testEmployeeName,
			testEmployeeEmail,
		} = body as TimeEntryFormData;

		// Validate required fields
		if (!customer || !project || !description) {
			return new Response(
				JSON.stringify({ error: 'Missing required fields: customer, project, and description are required' }),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// Get user info from session (allow dev-only overrides for Postman QA across all employees)
		const hasTestOverrides = Boolean(testEmployeeName || testEmployeeEmail);
		if (hasTestOverrides && !dev) {
			return new Response(JSON.stringify({ error: 'Employee test overrides are only allowed in development' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		const userName =
			(hasTestOverrides ? testEmployeeName : session.user?.name) ||
			(hasTestOverrides ? testEmployeeEmail : session.user?.email) ||
			'Unknown User';
		const userEmail =
			(hasTestOverrides ? testEmployeeEmail : session.user?.email) ||
			(hasTestOverrides ? '' : (session.user as any)?.userPrincipalName) ||
			'';

		// Resolve employee using deterministic matching + LLM disambiguation against prod_employees.
		const employee = await resolveEmployeeForWebhook(userName, userEmail);
		if (!employee) {
			console.error('[TimeEntry] Employee not found from identity:', { userName, userEmail });
			return new Response(
				JSON.stringify({
					error: `Employee identity could not be resolved from "${userName}" / "${userEmail}" in prod_employees`,
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// Look up customer QBO ID from database
		const customerRecord = await getCustomerByName(customer);
		if (!customerRecord) {
			console.error('[TimeEntry] Customer not found:', customer);
			return new Response(
				JSON.stringify({ error: `Customer "${customer}" not found in database` }),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		console.log('[TimeEntry] Lookup results:', {
			employee: { name: employee.name, qbo_id: employee.qbo_id },
			customer: { name: customerRecord.name, qbo_id: customerRecord.qbo_id },
		});

		// Build the payload for n8n webhook (matching the format expected by n8n)
		const timeEntryPayload = {
			// Employee info with QBO ID
			employee_name: employee.name,
			employee_qbo_id: employee.qbo_id,

			// Customer info with QBO ID
			customer_name: customerRecord.name,
			customer_qbo_id: customerRecord.qbo_id,

			// Form data
			project: project,
			tasks_completed: description,

			// Time info
			hours: hours || 0,
			billable: true,
			entry_date: entryDate || getTodayEastern(),

			// Metadata
			submitted_by: userName,
			submitted_at: new Date().toISOString(),
			source: 'time_entry_form',
		};

		console.log('[TimeEntry] Sending to webhook:', {
			url: env.BILLI_DEV_WEBHOOK_URL,
			payload: timeEntryPayload,
		});

		// Send to n8n webhook
		const response = await fetch(env.BILLI_DEV_WEBHOOK_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ timeEntry: timeEntryPayload }),
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error('[TimeEntry] Webhook error:', response.status, errorText);
			return new Response(
				JSON.stringify({
					error: 'Failed to submit time entry',
					details: errorText,
				}),
				{
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// Parse response if available
		let webhookResult = null;
		const responseText = await response.text();
		if (responseText && responseText.trim()) {
			try {
				webhookResult = JSON.parse(responseText);
			} catch {
				// Non-JSON response is OK
				webhookResult = { raw: responseText };
			}
		}

		console.log('[TimeEntry] Webhook response:', webhookResult);

		return new Response(
			JSON.stringify({
				success: true,
				message: 'Time entry submitted successfully',
				timeEntry: timeEntryPayload,
				webhookResult,
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	} catch (error: any) {
		console.error('[TimeEntry] Error:', error);
		return new Response(
			JSON.stringify({ error: error.message || 'An unexpected error occurred' }),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}
};
