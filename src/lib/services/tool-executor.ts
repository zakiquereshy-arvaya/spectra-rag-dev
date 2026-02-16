/**
 * Tool Executor
 * Handles all tool call execution (calendar + billing).
 * Extracted from unified-mcp-server.ts for modularity and testability.
 */

import { MicrosoftGraphService } from './microsoft-graph';
import { CalendarAIHelper } from './ai-calendar-helpers';
import {
	getEmployeeByName,
	getCustomerByName,
	getAllEmployees,
	getAllCustomers,
	type Employee,
	type Customer,
} from './azero-db';
import {
	getTodayEastern,
	formatDateEastern,
	getEasternOffset,
	parseNaturalDate,
	convertToEasternTime,
	formatEasternDateTime,
} from '$lib/utils/datetime';

export class ToolExecutor {
	private graphService: MicrosoftGraphService;
	private aiHelper: CalendarAIHelper | null;
	private loggedInUser: { name: string; email: string } | null;
	private webhookUrl: string;

	// Caches
	private cachedUsers: Array<{ name: string; email: string }> | null = null;
	private cachedEmployees: Employee[] | null = null;
	private cachedCustomers: Customer[] | null = null;

	// State
	lastAvailabilityDate: string | null = null;

	constructor(
		graphService: MicrosoftGraphService,
		aiHelper: CalendarAIHelper | null,
		loggedInUser: { name: string; email: string } | null,
		webhookUrl: string
	) {
		this.graphService = graphService;
		this.aiHelper = aiHelper;
		this.loggedInUser = loggedInUser;
		this.webhookUrl = webhookUrl;
	}

	// ==================== CACHES ====================

	async getCachedUsers(): Promise<Array<{ name: string; email: string }>> {
		if (this.cachedUsers === null) {
			const users = await this.graphService.listUsers();
			this.cachedUsers = users.value.map((user: any) => ({
				name: user.displayName,
				email: user.mail || user.userPrincipalName,
			}));
		}
		return this.cachedUsers;
	}

	private async getCachedEmployees(): Promise<Employee[]> {
		if (this.cachedEmployees === null) {
			this.cachedEmployees = await getAllEmployees();
		}
		return this.cachedEmployees;
	}

	private async getCachedCustomers(): Promise<Customer[]> {
		if (this.cachedCustomers === null) {
			this.cachedCustomers = await getAllCustomers();
		}
		return this.cachedCustomers;
	}

	// ==================== DATE/TIME HELPERS ====================

	parseDate(dateString: string | undefined | null): string {
		return parseNaturalDate(dateString);
	}

	private convertToLocalTime(utcDateTime: string): string {
		const dateStr = utcDateTime.endsWith('Z') ? utcDateTime : utcDateTime + 'Z';
		const date = new Date(dateStr);
		return date.toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true,
			timeZone: 'America/New_York',
		});
	}

	private formatLocalDateTime(utcDateTime: string): string {
		const dateTimeStr = utcDateTime.endsWith('Z') ? utcDateTime : utcDateTime + 'Z';
		const date = new Date(dateTimeStr);
		const dateStr = date.toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'numeric',
			day: 'numeric',
			year: 'numeric',
			timeZone: 'America/New_York',
		});
		const timeStr = date.toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true,
			timeZone: 'America/New_York',
		});
		return `${dateStr} ${timeStr}`;
	}

	private getEasternOffset(dateStr: string): string {
		return getEasternOffset(dateStr);
	}

	// ==================== TOOL EXECUTION ====================

	async execute(name: string, args: Record<string, any>): Promise<any> {
		try {
			switch (name) {
				case 'get_users_with_name_and_email':
					return await this.getCachedUsers();

				case 'check_availability':
					return await this.executeCheckAvailability(args);

				case 'get_free_slots':
					return await this.executeGetFreeSlots(args);

				case 'book_meeting':
					return await this.executeBookMeeting(args);

				case 'lookup_employee':
					return await this.executeLookupEmployee(args);

				case 'lookup_customer':
					return await this.executeLookupCustomer(args);

				case 'list_employees':
					return await this.executeListEmployees();

				case 'list_customers':
					return await this.executeListCustomers();

				case 'submit_time_entry':
					return await this.executeSubmitTimeEntry(args);

				default:
					throw new Error(`Unknown tool: ${name}`);
			}
		} catch (error: any) {
			console.error(`[ToolExecutor] Tool error for ${name}:`, error);
			throw new Error(`Tool execution error: ${error.message}`);
		}
	}

	// ==================== CALENDAR TOOLS ====================

	private async executeCheckAvailability(args: Record<string, any>): Promise<any> {
		let userEmail = args.user_email;
		const date = args.date;
		const durationMinutes =
			typeof args.duration_minutes === 'number' && args.duration_minutes > 0
				? Math.round(args.duration_minutes)
				: 30;

		if (!userEmail.includes('@')) {
			if (!this.aiHelper) throw new Error('Please provide user_email as an email address');
			const usersList = await this.getCachedUsers();
			const targetUser = await this.aiHelper.matchUserName(userEmail, usersList);
			if (!targetUser) throw new Error(`User '${userEmail}' not found. Use get_users_with_name_and_email to see available users.`);
			userEmail = targetUser.email;
		}

		const parsedDate = this.parseDate(date);
		this.lastAvailabilityDate = parsedDate;
		const easternOffset = this.getEasternOffset(parsedDate);
		const calendarOffset = this.getEasternOffset(parsedDate);
		const dateObj = new Date(parsedDate + 'T00:00:00' + calendarOffset);
		const startDateTime = dateObj.toISOString();
		const nextDay = new Date(dateObj);
		nextDay.setDate(nextDay.getDate() + 1);
		const endDateTime = nextDay.toISOString();

		const events = await this.graphService.getUserCalendarView(userEmail, startDateTime, endDateTime);

		const busyTimes = events.value
			.filter((event: any) => !event.isAllDay)
			.map((event: any) => ({
				subject: event.subject,
				start: this.convertToLocalTime(event.start.dateTime),
				end: this.convertToLocalTime(event.end.dateTime),
				start_datetime: this.formatLocalDateTime(event.start.dateTime),
				end_datetime: this.formatLocalDateTime(event.end.dateTime),
			}));

		const availableSlots = await this.graphService.getAvailableSlotsForUser(
			userEmail,
			`${parsedDate}T08:00:00${easternOffset}`,
			`${parsedDate}T17:00:00${easternOffset}`,
			durationMinutes,
			'Eastern Standard Time'
		);

		let freeSlots = availableSlots.map((slot: any) => {
			const startLocal = this.convertToLocalTime(slot.start);
			const endLocal = this.convertToLocalTime(slot.end);
			const durationHours =
				(new Date(slot.end).getTime() - new Date(slot.start).getTime()) / (1000 * 60 * 60);
			return {
				start: startLocal,
				end: endLocal,
				duration_hours: Math.round(durationHours * 10) / 10,
			};
		});

		// Filter out past events/slots if checking today
		const todayEastern = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
		const isToday = parsedDate === todayEastern;
		let filteredBusyTimes = busyTimes;
		if (isToday) {
			const now = new Date();
			const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
			const currentHour = eastern.getHours() + eastern.getMinutes() / 60;
			const parseTimeToHour = (t: string) => {
				const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
				if (!m) return 0;
				let h = parseInt(m[1]);
				const min = parseInt(m[2]);
				const p = m[3].toUpperCase();
				if (p === 'PM' && h !== 12) h += 12;
				if (p === 'AM' && h === 12) h = 0;
				return h + min / 60;
			};
			filteredBusyTimes = busyTimes.filter((e: any) => parseTimeToHour(e.end) > currentHour);
			freeSlots = freeSlots.filter((s: any) => parseTimeToHour(s.end) > currentHour);
		}

		const displayDate = new Date(parsedDate + 'T00:00:00');
		const dayOfWeek = displayDate.toLocaleDateString('en-US', {
			weekday: 'long',
			timeZone: 'America/New_York',
		});

		return {
			user_email: userEmail,
			date: parsedDate,
			day_of_week: dayOfWeek,
			busy_times: filteredBusyTimes,
			total_events: filteredBusyTimes.length,
			free_slots: freeSlots,
			is_completely_free: filteredBusyTimes.length === 0,
			slot_minutes: durationMinutes,
			note: isToday
				? 'All times are in Eastern Time (EST/EDT). Past events and expired slots have been filtered out.'
				: 'All times are in Eastern Time (EST/EDT)',
		};
	}

	private async executeGetFreeSlots(args: Record<string, any>): Promise<any> {
		let userEmail = args.user_email;
		const date = args.date;
		const durationMinutes =
			typeof args.duration_minutes === 'number' && args.duration_minutes > 0
				? Math.round(args.duration_minutes)
				: 30;

		if (!userEmail.includes('@')) {
			if (!this.aiHelper) throw new Error('Please provide user_email as an email address');
			const usersList = await this.getCachedUsers();
			const targetUser = await this.aiHelper.matchUserName(userEmail, usersList);
			if (!targetUser) throw new Error(`User '${userEmail}' not found. Use get_users_with_name_and_email to see available users.`);
			userEmail = targetUser.email;
		}

		const parsedDate = this.parseDate(date);
		const easternOffset = this.getEasternOffset(parsedDate);

		const availableSlots = await this.graphService.getAvailableSlotsForUser(
			userEmail,
			`${parsedDate}T08:00:00${easternOffset}`,
			`${parsedDate}T17:00:00${easternOffset}`,
			durationMinutes,
			'Eastern Standard Time'
		);

		let formattedSlots = availableSlots.map((slot: any) => {
			const startLocal = this.convertToLocalTime(slot.start);
			const endLocal = this.convertToLocalTime(slot.end);
			const durationHours = (new Date(slot.end).getTime() - new Date(slot.start).getTime()) / (1000 * 60 * 60);
			return {
				start: startLocal,
				end: endLocal,
				duration_hours: Math.round(durationHours * 10) / 10,
			};
		});

		// Filter out past slots if checking today
		const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
		const isTodayFS = parsedDate === todayET;
		if (isTodayFS) {
			const now = new Date();
			const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
			const currentHour = eastern.getHours() + eastern.getMinutes() / 60;
			const parseTimeToHour = (t: string) => {
				const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
				if (!m) return 0;
				let h = parseInt(m[1]);
				const min = parseInt(m[2]);
				const p = m[3].toUpperCase();
				if (p === 'PM' && h !== 12) h += 12;
				if (p === 'AM' && h === 12) h = 0;
				return h + min / 60;
			};
			formattedSlots = formattedSlots.filter((s: any) => parseTimeToHour(s.end) > currentHour);
		}

		const displayDate = new Date(parsedDate + 'T00:00:00');
		const dayOfWeek = displayDate.toLocaleDateString('en-US', {
			weekday: 'long',
			timeZone: 'America/New_York',
		});

		return {
			user_email: userEmail,
			date: parsedDate,
			day_of_week: dayOfWeek,
			free_slots: formattedSlots,
			slot_minutes: durationMinutes,
			note: isTodayFS
				? 'All times are in Eastern Time (EST/EDT). Past slots have been filtered out.'
				: 'All times are in Eastern Time (EST/EDT)',
		};
	}

	private async executeBookMeeting(args: Record<string, any>): Promise<any> {
		let { user_email, subject, start_datetime, end_datetime, attendees, body } = args;

		if (!subject?.trim()) {
			throw new Error('Meeting subject is REQUIRED. Please ask the user for the meeting subject/title.');
		}
		if (!this.loggedInUser) {
			throw new Error('No logged-in user information available.');
		}
		if (!this.aiHelper) {
			throw new Error('AI helper not available.');
		}

		const usersList = await this.getCachedUsers();
		const senderUser = await this.aiHelper.validateSender(
			this.loggedInUser.name,
			this.loggedInUser.email,
			usersList
		);

		if (!user_email.includes('@')) {
			const targetUser = await this.aiHelper.matchUserName(user_email, usersList);
			if (!targetUser) throw new Error(`User '${user_email}' not found. Use get_users_with_name_and_email to see available users.`);
			user_email = targetUser.email;
		}

		const dateStr = this.lastAvailabilityDate || getTodayEastern();
		const parseTimeInEastern = (timeStr: string): string => {
			const trimmed = timeStr.trim();
			if (trimmed.includes('T')) return trimmed;

			let normalized = trimmed;
			if (/^\d{3,4}$/.test(normalized)) {
				normalized = normalized.length === 3
					? `${normalized[0]}:${normalized.slice(1)}`
					: `${normalized.slice(0, 2)}:${normalized.slice(2)}`;
			}

			const timeMatch = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
			if (timeMatch) {
				let hours = parseInt(timeMatch[1], 10);
				const minutes = parseInt(timeMatch[2] || '0', 10);
				let period = timeMatch[3]?.toUpperCase();

				if (!period) {
					period = hours >= 1 && hours <= 11 ? 'AM' : 'PM';
					if (hours >= 13) hours -= 12;
				} else {
					if (period === 'PM' && hours !== 12) hours += 12;
					else if (period === 'AM' && hours === 12) hours = 0;
				}

				return `${dateStr}T${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
			}
			return trimmed;
		};

		const startISO = parseTimeInEastern(start_datetime);
		const endISO = parseTimeInEastern(end_datetime);

		const event = await this.graphService.createEventForUser(user_email, {
			subject,
			start: startISO,
			end: endISO,
			timeZone: 'Eastern Standard Time',
			senderName: senderUser.name,
			senderEmail: senderUser.email,
			attendees: attendees || [],
			body: body || '',
			isOnlineMeeting: true,
		});

		const meetingOffset = this.getEasternOffset(dateStr);
		const startDt = new Date(startISO + meetingOffset);
		const endDt = new Date(endISO + meetingOffset);
		const teamsLink = (event as any).onlineMeeting?.joinUrl || null;

		return {
			id: event.id,
			subject: event.subject,
			validated_date_info: {
				subject,
				day_of_week: startDt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }),
				date_formatted: startDt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }),
				start_time: startDt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }),
				end_time: endDt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }),
				teams_link: teamsLink,
				sender_name: senderUser.name,
				sender_email: senderUser.email,
			},
		};
	}

	// ==================== BILLING TOOLS ====================

	private async executeLookupEmployee(args: Record<string, any>): Promise<any> {
		const { name: employeeName } = args;
		if (!employeeName) throw new Error('Employee name is required');

		const employee = await getEmployeeByName(employeeName);
		if (!employee) {
			const allEmployees = await this.getCachedEmployees();
			return {
				found: false,
				error: `Employee "${employeeName}" not found`,
				suggestions: allEmployees.slice(0, 5).map((e) => e.name),
			};
		}
		return { found: true, employee: { name: employee.name, email: employee.email, qbo_id: employee.qbo_id } };
	}

	private async executeLookupCustomer(args: Record<string, any>): Promise<any> {
		const { name: customerName } = args;
		if (!customerName) throw new Error('Customer name is required');

		const customer = await getCustomerByName(customerName);
		if (!customer) {
			const allCustomers = await this.getCachedCustomers();
			return {
				found: false,
				error: `Customer "${customerName}" not found`,
				suggestions: allCustomers.slice(0, 5).map((c) => c.name),
			};
		}
		return { found: true, customer: { name: customer.name, qbo_id: customer.qbo_id } };
	}

	private async executeListEmployees(): Promise<any> {
		const employees = await this.getCachedEmployees();
		return { employees: employees.map((e) => ({ name: e.name, email: e.email, qbo_id: e.qbo_id })), total: employees.length };
	}

	private async executeListCustomers(): Promise<any> {
		const customers = await this.getCachedCustomers();
		return { customers: customers.map((c) => ({ name: c.name, qbo_id: c.qbo_id })), total: customers.length };
	}

	private async executeSubmitTimeEntry(args: Record<string, any>): Promise<any> {
		const {
			employee_name, employee_qbo_id, customer_name, customer_qbo_id,
			tasks_completed, hours, billable = true, entry_date,
		} = args;

		if (!employee_name || !employee_qbo_id) {
			throw new Error('STOP. You must call lookup_employee first to get the real QBO ID. Do not make up IDs.');
		}
		if (!customer_name || !customer_qbo_id) {
			throw new Error('STOP. You must call lookup_customer first to get the real QBO ID. Do not make up IDs.');
		}

		const fakeIdPatterns = /^(EMP|CUST|ID|QBO|TEST|PLACEHOLDER|XXX|000)/i;
		const placeholderNamePatterns = /^(unknown|placeholder|test|employee|user|n\/?a)\b/i;
		if (placeholderNamePatterns.test(String(employee_name).trim())) {
			throw new Error(`INVALID employee_name "${employee_name}". You MUST resolve a real employee from prod_employees first.`);
		}
		if (fakeIdPatterns.test(String(employee_qbo_id))) {
			throw new Error(`INVALID employee_qbo_id "${employee_qbo_id}". You MUST call lookup_employee("${employee_name}") first to get the real ID from the database.`);
		}
		if (fakeIdPatterns.test(String(customer_qbo_id))) {
			throw new Error(`INVALID customer_qbo_id "${customer_qbo_id}". You MUST call lookup_customer("${customer_name}") first to get the real ID from the database.`);
		}

		if (!tasks_completed) throw new Error('Tasks completed description is required');
		if (hours === undefined || hours <= 0) throw new Error('Hours must be positive');

		const timeEntry = {
			employee_name, employee_qbo_id, customer_name, customer_qbo_id,
			tasks_completed, hours: parseFloat(hours), billable: billable !== false,
			entry_date: entry_date || getTodayEastern(),
			submitted_by: this.loggedInUser?.name || 'Unknown User',
			submitted_at: new Date().toISOString(),
		};

		if (!this.webhookUrl) {
			throw new Error('Webhook URL not configured for time entry submission');
		}

		const response = await fetch(this.webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ timeEntry }),
		});

		if (!response.ok) {
			throw new Error(`Failed to submit time entry: ${response.statusText}`);
		}

		return {
			success: true,
			message: 'Time entry submitted successfully',
			timeEntry: {
				employee_name,
				customer_name,
				tasks_completed,
				hours: parseFloat(hours),
				billable: billable !== false,
				entry_date: entry_date || getTodayEastern(),
				submitted_by: this.loggedInUser?.name || 'Unknown User',
			},
		};
	}

	// ==================== STATUS LABELS ====================

	getToolStatusLabel(toolName: string): string {
		switch (toolName) {
			case 'check_availability':
			case 'get_free_slots':
				return 'Checking calendar...';
			case 'book_meeting':
				return 'Booking meeting...';
			case 'get_users_with_name_and_email':
				return 'Looking up users...';
			case 'lookup_employee':
				return 'Looking up employee...';
			case 'lookup_customer':
				return 'Looking up customer...';
			case 'list_employees':
				return 'Loading employees...';
			case 'list_customers':
				return 'Loading customers...';
			case 'submit_time_entry':
				return 'Submitting time entry...';
			default:
				return 'Processing...';
		}
	}
}
