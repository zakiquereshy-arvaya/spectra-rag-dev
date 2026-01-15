// Time Entry Service - Hybrid Billi Implementation
// Handles AI extraction and DB lookups in SvelteKit,
// sends prepared data to n8n for QB/Monday.com

import { CohereClientV2 } from 'cohere-ai';
import {
	getEmployeeByName,
	getCustomerByName,
	getAllEmployees,
	getAllCustomers,
	type Employee,
	type Customer,
} from './azero-db';
import type {
	TimeEntryInput,
	ExtractedTimeData,
	ExtractedEntityData,
	TimeEntry,
	TimeEntryResult,
} from '$lib/types/time-entry';

export class TimeEntryService {
	private client: CohereClientV2;
	private model: string;

	constructor(apiKey: string, model: string = 'command-a-03-2025') {
		this.client = new CohereClientV2({ token: apiKey });
		this.model = model;
	}

	async extractTimeDetails(message: string): Promise<ExtractedTimeData> {
		const today = new Date().toISOString().split('T')[0];

		const prompt = `Extract time entry details from this message. Return ONLY valid JSON.

Message: "${message}"
Today's date: ${today}

Extract:
- tasks_completed: Brief description of work done (keep the full natural language description)
- hours: Number of hours (decimal allowed, e.g., 1.5). Convert minutes to decimal (30 min = 0.5)
- billable: true/false (assume true unless explicitly stated as internal, admin, or non-billable)

Return JSON format:
{
  "tasks_completed": "...",
  "hours": X.X,
  "billable": true/false
}

If hours not specified, estimate based on context or use 0.
Return ONLY the JSON, no other text.`;

		const response = await this.client.chat({
			model: this.model,
			messages: [
				{
					role: 'system',
					content: 'You are a time entry extraction assistant. Return only valid JSON.',
				},
				{ role: 'user', content: prompt },
			],
		});

		return this.parseJsonResponse<ExtractedTimeData>(response, {
			tasks_completed: '',
			hours: 0,
			billable: true,
		});
	}

	async extractEntityNames(
		message: string,
		userName: string,
		employees: Employee[],
		customers: Customer[]
	): Promise<ExtractedEntityData> {
		const employeeNames = employees.map((e) => e.name).join(', ');
		const customerNames = customers.map((c) => c.name).join(', ');

		const prompt = `Extract employee and customer from this time entry message.

Message: "${message}"
Submitted by: ${userName}

Available employees: ${employeeNames}
Available customers: ${customerNames}

Rules:
- employee_name: The person who did the work. If not explicitly mentioned, assume it's the submitter: "${userName}"
- customer_name: The client/customer the work was for. Look for company names, project names, or phrases like "for [customer]"
- Match names fuzzy (partial matches are OK)
- Common aliases: "ICE" = "Infrastructure Consulting & Engineering", "Arvaya" = search for customers with "Arvaya" in name

Return JSON:
{
  "employee_name": "...",
  "customer_name": "..."
}

Return ONLY the JSON, no other text.`;

		const response = await this.client.chat({
			model: this.model,
			messages: [
				{
					role: 'system',
					content: 'You are an entity extraction assistant. Return only valid JSON.',
				},
				{ role: 'user', content: prompt },
			],
		});

		return this.parseJsonResponse<ExtractedEntityData>(response, {
			employee_name: userName,
			customer_name: '',
		});
	}

	async processTimeEntry(input: TimeEntryInput): Promise<TimeEntryResult> {
		try {
			const [employees, customers] = await Promise.all([getAllEmployees(), getAllCustomers()]);

			const [timeData, entityData] = await Promise.all([
				this.extractTimeDetails(input.message),
				this.extractEntityNames(input.message, input.userName, employees, customers),
			]);

			console.log('[TimeEntry] Extracted time data:', timeData);
			console.log('[TimeEntry] Extracted entity data:', entityData);

			const [employee, customer] = await Promise.all([
				getEmployeeByName(entityData.employee_name),
				getCustomerByName(entityData.customer_name),
			]);

			if (!employee) {
				return {
					success: false,
					error: `Employee not found: "${entityData.employee_name}". Please specify who did the work.`,
					extractedData: { timeData, entityData },
				};
			}

			if (!customer) {
				return {
					success: false,
					error: `Customer not found: "${entityData.customer_name}". Please specify which customer/client this work was for.`,
					extractedData: { timeData, entityData },
				};
			}

			console.log('[TimeEntry] Found employee:', employee.name, 'QBO ID:', employee.qbo_id);
			console.log('[TimeEntry] Found customer:', customer.name, 'QBO ID:', customer.qbo_id);

			const timeEntry: TimeEntry = {
				employee_name: employee.name,
				employee_qbo_id: employee.qbo_id,
				customer_name: customer.name,
				customer_qbo_id: customer.qbo_id,
				tasks_completed: timeData.tasks_completed,
				hours: timeData.hours,
				billable: timeData.billable,
				entry_date: new Date().toISOString().split('T')[0],
				submitted_by: input.userName,
				submitted_at: input.localTimestamp,
			};

			return {
				success: true,
				timeEntry,
				extractedData: { timeData, entityData },
			};
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : 'Failed to process time entry';
			console.error('[TimeEntry] Error:', error);
			return {
				success: false,
				error: errorMessage,
			};
		}
	}

	/**
	 * Parse JSON response from Cohere, handling markdown code blocks
	 */
	private parseJsonResponse<T>(response: unknown, defaultValue: T): T {
		let text = '';
		const message = (response as { message?: { content?: unknown } })?.message;
		const content = message?.content;

		if (typeof content === 'string') {
			text = content.trim();
		} else if (Array.isArray(content)) {
			text = content
				.filter((item: unknown) => (item as { type?: string })?.type === 'text')
				.map((item: unknown) => (item as { text?: string })?.text || '')
				.join('')
				.trim();
		}

		if (!text) return defaultValue;

		// Handle markdown code blocks
		if (text.startsWith('```')) {
			const parts = text.split('```');
			if (parts.length > 1) {
				text = parts[1];
				if (text.startsWith('json')) {
					text = text.slice(4);
				}
				text = text.trim();
			}
		}

		try {
			return JSON.parse(text);
		} catch {
			console.warn('[TimeEntry] Failed to parse JSON response:', text);
			return defaultValue;
		}
	}
}
