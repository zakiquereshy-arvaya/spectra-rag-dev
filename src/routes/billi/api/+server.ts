import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { TimeEntryService } from '$lib/services/time-entry';

export const POST: RequestHandler = async (event) => {
	const session = await event.locals.auth();

	if (!session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = await event.request.json();
		const { message } = body;

		if (!message || typeof message !== 'string') {
			return json({ error: 'Message is required' }, { status: 400 });
		}

		// Get user information from session
		const userName = session.user?.name || session.user?.email || 'Unknown User';
		const userEmail = session.user?.email || '';

		// Initialize time entry service
		const timeEntryService = new TimeEntryService(env.COHERE_API_KEY);

		// Process the time entry (AI extraction + DB lookups)
		const result = await timeEntryService.processTimeEntry({
			message,
			userName,
			userEmail,
			localTimestamp: new Date().toISOString(),
		});

		if (!result.success || !result.timeEntry) {
			return json({
				output: `I couldn't process that time entry: ${result.error}\n\nCould you please provide more details about the employee, customer, hours, and tasks?`,
				error: result.error,
			});
		}

		// Send prepared data to simplified n8n webhook (for QB + Monday.com)
		const n8nResponse = await fetch(BILLI_DEV_WEBHOOK_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				timeEntry: result.timeEntry,
				// Include extracted data for debugging/logging
				extractedData: result.extractedData,
			}),
		});

		// Parse n8n response safely (may be empty or non-JSON)
		const n8nResponseText = await n8nResponse.text();
		let n8nResult = null;

		if (!n8nResponse.ok) {
			console.error('[Billi] n8n webhook error:', n8nResponseText);
			return json({
				output: `Time entry processed but failed to submit to QuickBooks: ${n8nResponse.statusText}`,
				timeEntry: result.timeEntry,
			});
		}

		// Try to parse JSON if response has content
		if (n8nResponseText && n8nResponseText.trim()) {
			try {
				n8nResult = JSON.parse(n8nResponseText);
			} catch {
				console.warn('[Billi] n8n returned non-JSON response:', n8nResponseText);
			}
		}

		// Build success response
		const successMessage = `Time entry submitted successfully!

**Employee:** ${result.timeEntry.employee_name}
**Customer:** ${result.timeEntry.customer_name}
**Hours:** ${result.timeEntry.hours}
**Tasks:** ${result.timeEntry.tasks_completed}
**Billable:** ${result.timeEntry.billable ? 'Yes' : 'No'}`;

		return json({
			output: successMessage,
			timeEntry: result.timeEntry,
			quickbooksResult: n8nResult,
		});
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : 'Internal error';
		console.error('[Billi] API error:', error);
		return json({ error: errorMessage }, { status: 500 });
	}
};
