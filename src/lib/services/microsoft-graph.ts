// Microsoft Graph API Service for Calendar Operations

import type {
	MicrosoftGraphEvent,
	MicrosoftGraphCalendar,
	MicrosoftGraphCalendarViewParams,
	MicrosoftGraphFreeBusyRequest,
	MicrosoftGraphFreeBusyResponse,
	CreateEventRequest,
} from '$lib/types/microsoft-graph';
import { MicrosoftGraphAuth } from './microsoft-graph-auth';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

export class MicrosoftGraphService {
	private accessToken: string | null;
	private authService: MicrosoftGraphAuth | null;

	constructor(accessToken?: string, authService?: MicrosoftGraphAuth) {
		this.accessToken = accessToken || null;
		this.authService = authService || null;
	}

	/**
	 * Get access token - use app-only if available, otherwise use delegated token
	 */
	private async getToken(): Promise<string> {
		if (this.authService) {
			// Use app-only token (client credentials) - has access to all users
			return await this.authService.getAccessToken();
		}
		if (this.accessToken) {
			// Use delegated token (user's own permissions)
			return this.accessToken;
		}
		throw new Error('No access token or auth service available');
	}

	private async request<T>(
		endpoint: string,
		options: RequestInit = {}
	): Promise<T> {
		const url = `${GRAPH_API_BASE}${endpoint}`;
		const token = await this.getToken();
		
		const response = await fetch(url, {
			...options,
			headers: {
				'Authorization': `Bearer ${token}`,
				'Content-Type': 'application/json',
				...options.headers,
			},
		});

		if (!response.ok) {
			const errorText = await response.text();
			let error: any;
			try {
				error = JSON.parse(errorText);
			} catch {
				error = { message: errorText || response.statusText };
			}
			
			console.error('Microsoft Graph API error:', {
				status: response.status,
				statusText: response.statusText,
				endpoint: url,
				error: error,
			});
			
			// Extract more detailed error message
			const errorMessage = error.error?.message || error.message || errorText || response.statusText;
			const errorCode = error.error?.code || error.code || '';
			
			throw new Error(
				`Microsoft Graph API error (${response.status}${errorCode ? ` - ${errorCode}` : ''}): ${errorMessage}`
			);
		}

		return response.json();
	}

	/**
	 * Get user's calendars
	 * Note: With app-only tokens, use getCalendarsForUser instead
	 */
	async getCalendars(): Promise<{ value: MicrosoftGraphCalendar[] }> {
		// Try /me endpoint first (works with delegated tokens)
		// If that fails and we have app-only auth, we can't use /me
		try {
			return this.request<{ value: MicrosoftGraphCalendar[] }>('/me/calendars');
		} catch (error: any) {
			if (error.message?.includes('401') || error.message?.includes('403')) {
				throw new Error('Cannot access /me/calendars with app-only token. Use getCalendarsForUser(userId) instead.');
			}
			throw error;
		}
	}

	/**
	 * Get calendars for a specific user (works with app-only tokens)
	 */
	async getCalendarsForUser(userId: string): Promise<{ value: MicrosoftGraphCalendar[] }> {
		return this.request<{ value: MicrosoftGraphCalendar[] }>(`/users/${userId}/calendars`);
	}

	/**
	 * List all users in the organization
	 * Handles pagination to get all users
	 */
	async listUsers(): Promise<{ value: Array<{ id: string; displayName: string; mail?: string; userPrincipalName: string }> }> {
		const allUsers: Array<{ id: string; displayName: string; mail?: string; userPrincipalName: string }> = [];
		let nextLink: string | null = null;
		let pageCount = 0;
		const maxPages = 50; // Safety limit

		while (pageCount < maxPages) {
			let endpoint: string;
			if (nextLink) {
				// Handle full URL or relative path
				if (nextLink.startsWith('http://') || nextLink.startsWith('https://')) {
					const token = await this.getToken();
					const fetchResponse = await fetch(nextLink, {
						headers: {
							'Authorization': `Bearer ${token}`,
							'Content-Type': 'application/json',
						},
					});

					if (!fetchResponse.ok) {
						throw new Error(`Failed to fetch users: ${fetchResponse.status} ${fetchResponse.statusText}`);
					}

					const pageData: { value: Array<{ id: string; displayName: string; mail?: string; userPrincipalName: string }>; '@odata.nextLink'?: string } = await fetchResponse.json();
					allUsers.push(...(pageData.value || []));
					nextLink = pageData['@odata.nextLink'] || null;
				} else {
					endpoint = nextLink.startsWith('/') ? nextLink : `/${nextLink}`;
					const response = await this.request<{ value: Array<{ id: string; displayName: string; mail?: string; userPrincipalName: string }>; '@odata.nextLink'?: string }>(endpoint);
					allUsers.push(...response.value);
					nextLink = response['@odata.nextLink'] || null;
				}
			} else {
				// First page
				endpoint = '/users?$select=id,displayName,mail,userPrincipalName&$top=999';
				const response = await this.request<{ value: Array<{ id: string; displayName: string; mail?: string; userPrincipalName: string }>; '@odata.nextLink'?: string }>(endpoint);
				allUsers.push(...response.value);
				nextLink = response['@odata.nextLink'] || null;
			}

			pageCount++;
			if (!nextLink) break;
		}

		if (pageCount >= maxPages && nextLink) {
			console.warn(`Reached maximum page limit (${maxPages}) for listUsers. There may be more users available.`);
		}

		console.log(`Retrieved ${allUsers.length} total users from ${pageCount} page(s)`);
		return { value: allUsers };
	}

	async resolveUserNameToEmail(userNameOrEmail: string): Promise<string> {
		if (userNameOrEmail.includes('@')) {
			return userNameOrEmail;
		}
		
		const users = await this.listUsers();
		const nameLower = userNameOrEmail.toLowerCase().trim();
		const nameParts = nameLower.split(/\s+/).filter(p => p.length > 0);
		
		let matchedUser = users.value.find(
			(u) => u.displayName.toLowerCase() === nameLower
		);
		
		if (!matchedUser) {
			matchedUser = users.value.find(
				(u) => {
					const displayLower = u.displayName.toLowerCase();
					return displayLower.includes(nameLower) || nameLower.includes(displayLower);
				}
			);
		}
		
		if (!matchedUser && nameParts.length > 1) {
			matchedUser = users.value.find((u) => {
				const displayLower = u.displayName.toLowerCase();
				return nameParts.every(part => displayLower.includes(part));
			});
		}
		
		if (!matchedUser && nameParts.length > 0) {
			matchedUser = users.value.find(
				(u) => u.displayName.toLowerCase().startsWith(nameParts[0])
			);
		}
		
		if (!matchedUser) {
			const suggestions = users.value
				.filter(u => {
					const displayLower = u.displayName.toLowerCase();
					return nameParts.some(part => displayLower.includes(part));
				})
				.slice(0, 5)
				.map(u => u.displayName);
			
			throw new Error(
				`User '${userNameOrEmail}' not found. ` +
				(suggestions.length > 0 
					? `Did you mean: ${suggestions.join(', ')}? ` 
					: '') +
				`Please use get_users_with_name_and_email tool first to see all available users.`
			);
		}
		
		return matchedUser.mail || matchedUser.userPrincipalName;
	}

	async getUserIdByEmail(email: string): Promise<string> {
		const users = await this.listUsers();
		for (const user of users.value) {
			if (user.mail && user.mail.toLowerCase() === email.toLowerCase()) {
				return user.id;
			}
			if (user.userPrincipalName.toLowerCase() === email.toLowerCase()) {
				return user.id;
			}
		}
		throw new Error(`User not found: ${email}`);
	}

	/**
	 * Get current user's email
	 */
	async getCurrentUserEmail(): Promise<string> {
		const me = await this.request<{ mail?: string; userPrincipalName: string }>('/me?$select=mail,userPrincipalName');
		return me.mail || me.userPrincipalName;
	}

	/**
	 * Get calendar view for a specific user
	 * Uses app-only token (client credentials) which has access to all users' calendars
	 */
	async getUserCalendarView(
		userEmail: string,
		startDateTime: string,
		endDateTime: string
	): Promise<{ value: MicrosoftGraphEvent[] }> {
		const queryParams = new URLSearchParams({
			startDateTime,
			endDateTime,
			$select: 'subject,start,end,isAllDay,showAs',
			$top: '1000', // Request more items per page to reduce pagination rounds
		});

		// Get user ID by email
		const userId = await this.getUserIdByEmail(userEmail);
		
		// Use /users/{userId}/calendarView endpoint (works with app-only permissions)
		const allEvents: MicrosoftGraphEvent[] = [];
		let nextLink: string | null = null;
		let pageCount = 0;
		const maxPages = 50; // Safety limit to prevent infinite loops

		while (pageCount < maxPages) {
			let endpoint: string;
			if (nextLink) {
				// If nextLink is a full URL, use it directly; otherwise prepend base
				if (nextLink.startsWith('http://') || nextLink.startsWith('https://')) {
					// Full URL - make direct request
					const token = await this.getToken();
					const fetchResponse = await fetch(nextLink, {
						headers: {
							'Authorization': `Bearer ${token}`,
							'Content-Type': 'application/json',
						},
					});

					if (!fetchResponse.ok) {
						const errorText = await fetchResponse.text();
						let error: any;
						try {
							error = JSON.parse(errorText);
						} catch {
							error = { message: errorText || fetchResponse.statusText };
						}
						
						console.error('Microsoft Graph API pagination error:', {
							status: fetchResponse.status,
							statusText: fetchResponse.statusText,
							endpoint: nextLink,
							error: error,
						});
						
						const errorMessage = error.error?.message || error.message || errorText || fetchResponse.statusText;
						const errorCode = error.error?.code || error.code || '';
						
						throw new Error(
							`Microsoft Graph API error (${fetchResponse.status}${errorCode ? ` - ${errorCode}` : ''}): ${errorMessage}`
						);
					}

					const pageData: { value: MicrosoftGraphEvent[]; '@odata.nextLink'?: string } = await fetchResponse.json();
					allEvents.push(...(pageData.value || []));
					nextLink = pageData['@odata.nextLink'] || null;
				} else {
					// Relative path - use request method
					endpoint = nextLink.startsWith('/') ? nextLink : `/${nextLink}`;
					const response = await this.request<{ value: MicrosoftGraphEvent[]; '@odata.nextLink'?: string }>(endpoint);
					allEvents.push(...response.value);
					nextLink = response['@odata.nextLink'] || null;
				}
			} else {
				// First page
				endpoint = `/users/${userId}/calendarView?${queryParams.toString()}`;
				const response = await this.request<{ value: MicrosoftGraphEvent[]; '@odata.nextLink'?: string }>(endpoint);
				allEvents.push(...response.value);
				nextLink = response['@odata.nextLink'] || null;
			}
			
			pageCount++;
			console.log(`Calendar view page ${pageCount}: ${allEvents.length} total events so far${nextLink ? ' (more pages available)' : ' (last page)'}`);
			
			if (!nextLink) break;
		}

		if (pageCount >= maxPages && nextLink) {
			console.warn(`Reached maximum page limit (${maxPages}) for calendar view. There may be more events available.`);
		}

		console.log(`Retrieved ${allEvents.length} total events for ${userEmail} from ${pageCount} page(s)`);
		return { value: allEvents };
	}

	/**
	 * Create event on sender's calendar and invite recipients as attendees
	 * The sender is the organizer, recipients receive invitations
	 */
	async createEventForUser(
		recipientEmail: string,
		event: CreateEventRequest & { senderName?: string; senderEmail?: string; isOnlineMeeting?: boolean }
	): Promise<MicrosoftGraphEvent> {
		if (!event.senderEmail) {
			throw new Error('senderEmail is required to create an event');
		}

		const senderUserId = await this.getUserIdByEmail(event.senderEmail);
		
		const graphEvent: MicrosoftGraphEvent = {
			subject: event.subject,
			start: {
				dateTime: event.start,
				timeZone: event.timeZone || 'Eastern Standard Time',
			},
			end: {
				dateTime: event.end,
				timeZone: event.timeZone || 'Eastern Standard Time',
			},
			isAllDay: event.isAllDay || false,
		};

		if (event.isOnlineMeeting) {
			(graphEvent as any).isOnlineMeeting = true;
			(graphEvent as any).onlineMeetingProvider = 'teamsForBusiness';
		}

		let bodyContent = '';
		if (event.body) {
			bodyContent = event.body;
		}

		if (bodyContent) {
			graphEvent.body = {
				contentType: 'html',
				content: bodyContent,
			};
		}

		// Build attendees list - include recipient and any additional attendees
		// Sender is automatically the organizer since event is created on their calendar
		const attendeesList: any[] = [];
		
		// Add recipient as attendee
		attendeesList.push({
			emailAddress: { address: recipientEmail },
			type: 'required',
		});

		// Add any additional attendees (avoid duplicates)
		if (event.attendees && event.attendees.length > 0) {
			for (const email of event.attendees) {
				if (email.toLowerCase() !== recipientEmail.toLowerCase() && 
				    email.toLowerCase() !== event.senderEmail?.toLowerCase()) {
					attendeesList.push({
						emailAddress: { address: email },
						type: 'required',
					});
				}
			}
		}

		if (attendeesList.length > 0) {
			graphEvent.attendees = attendeesList;
		}

		// Create event on sender's calendar - sender becomes the organizer
		return this.request<MicrosoftGraphEvent>(`/users/${senderUserId}/events`, {
			method: 'POST',
			body: JSON.stringify(graphEvent),
		});
	}

	/**
	 * Get calendar events within a date range
	 */
	async getCalendarView(
		calendarId: string = 'calendar',
		params: MicrosoftGraphCalendarViewParams
	): Promise<{ value: MicrosoftGraphEvent[] }> {
		const queryParams = new URLSearchParams({
			startDateTime: params.startDateTime,
			endDateTime: params.endDateTime,
		});

		if (params.$select) queryParams.append('$select', params.$select);
		if (params.$filter) queryParams.append('$filter', params.$filter);
		if (params.$orderby) queryParams.append('$orderby', params.$orderby);
		if (params.$top) queryParams.append('$top', params.$top.toString());

		const endpoint = calendarId === 'calendar'
			? `/me/calendar/calendarView?${queryParams.toString()}`
			: `/me/calendars/${calendarId}/calendarView?${queryParams.toString()}`;

		return this.request<{ value: MicrosoftGraphEvent[] }>(endpoint);
	}

	/**
	 * Get free/busy information for calendars
	 */
	async getFreeBusy(
		request: MicrosoftGraphFreeBusyRequest
	): Promise<MicrosoftGraphFreeBusyResponse> {
		return this.request<MicrosoftGraphFreeBusyResponse>('/me/calendar/getFreeBusy', {
			method: 'POST',
			body: JSON.stringify(request),
		});
	}

	/**
	 * Get schedule information for a specific user (app-only compatible)
	 */
	async getUserSchedule(
		userEmail: string,
		request: MicrosoftGraphFreeBusyRequest
	): Promise<MicrosoftGraphFreeBusyResponse> {
		const userId = await this.getUserIdByEmail(userEmail);
		return this.request<MicrosoftGraphFreeBusyResponse>(`/users/${userId}/calendar/getSchedule`, {
			method: 'POST',
			body: JSON.stringify(request),
		});
	}

	/**
	 * Create a new calendar event
	 */
	async createEvent(
		calendarId: string = 'calendar',
		event: CreateEventRequest
	): Promise<MicrosoftGraphEvent> {
		const graphEvent: MicrosoftGraphEvent = {
			subject: event.subject,
			start: {
				dateTime: event.start,
				timeZone: event.timeZone || 'UTC',
			},
			end: {
				dateTime: event.end,
				timeZone: event.timeZone || 'UTC',
			},
			isAllDay: event.isAllDay || false,
		};

		if (event.body) {
			graphEvent.body = {
				contentType: 'text',
				content: event.body,
			};
		}

		if (event.location) {
			graphEvent.location = {
				displayName: event.location,
			};
		}

		if (event.attendees && event.attendees.length > 0) {
			graphEvent.attendees = event.attendees.map((email) => ({
				emailAddress: {
					address: email,
				},
				type: 'required',
			}));
		}

		const endpoint = calendarId === 'calendar'
			? '/me/calendar/events'
			: `/me/calendars/${calendarId}/events`;

		return this.request<MicrosoftGraphEvent>(endpoint, {
			method: 'POST',
			body: JSON.stringify(graphEvent),
		});
	}

	/**
	 * Update an existing calendar event
	 */
	async updateEvent(
		eventId: string,
		updates: Partial<MicrosoftGraphEvent>
	): Promise<MicrosoftGraphEvent> {
		return this.request<MicrosoftGraphEvent>(`/me/calendar/events/${eventId}`, {
			method: 'PATCH',
			body: JSON.stringify(updates),
		});
	}

	/**
	 * Delete a calendar event
	 */
	async deleteEvent(eventId: string): Promise<void> {
		await this.request(`/me/calendar/events/${eventId}`, {
			method: 'DELETE',
		});
	}

	/**
	 * Get available time slots for a date range
	 */
	async getAvailableSlots(
		startDate: string,
		endDate: string,
		durationMinutes: number = 30,
		timeZone: string = 'UTC'
	): Promise<Array<{ start: string; end: string }>> {
		// Get free/busy information
		const freeBusyRequest: MicrosoftGraphFreeBusyRequest = {
			schedules: ['calendar'],
			startTime: {
				dateTime: startDate,
				timeZone,
			},
			endTime: {
				dateTime: endDate,
				timeZone,
			},
			availabilityViewInterval: durationMinutes,
		};

		const freeBusyResponse = await this.getFreeBusy(freeBusyRequest);
		
		if (!freeBusyResponse.value || freeBusyResponse.value.length === 0) {
			return [];
		}

		const schedule = freeBusyResponse.value[0];
		const availableSlots: Array<{ start: string; end: string }> = [];

		// Parse availability view to find free slots
		// The availabilityView is a string where each character represents a time slot
		// '0' = free, '1' = tentative, '2' = busy, '3' = OOF, '4' = working elsewhere
		const start = new Date(startDate);
		const end = new Date(endDate);
		const intervalMs = durationMinutes * 60 * 1000;

		for (let current = new Date(start); current < end; current = new Date(current.getTime() + intervalMs)) {
			const slotEnd = new Date(current.getTime() + intervalMs);
			
			// Check if this slot overlaps with any busy times
			const isBusy = schedule.scheduleItems?.some((item) => {
				const itemStart = new Date(item.start.dateTime);
				const itemEnd = new Date(item.end.dateTime);
				return (
					(current >= itemStart && current < itemEnd) ||
					(slotEnd > itemStart && slotEnd <= itemEnd) ||
					(current <= itemStart && slotEnd >= itemEnd)
				);
			});

			if (!isBusy) {
				availableSlots.push({
					start: current.toISOString(),
					end: slotEnd.toISOString(),
				});
			}
		}

		return availableSlots;
	}

	/**
	 * Get available time slots for a specific user (app-only compatible)
	 */
	async getAvailableSlotsForUser(
		userEmail: string,
		startDate: string,
		endDate: string,
		durationMinutes: number = 30,
		timeZone: string = 'UTC'
	): Promise<Array<{ start: string; end: string }>> {
		const freeBusyRequest: MicrosoftGraphFreeBusyRequest = {
			schedules: [userEmail],
			startTime: {
				dateTime: startDate,
				timeZone,
			},
			endTime: {
				dateTime: endDate,
				timeZone,
			},
			availabilityViewInterval: durationMinutes,
		};

		const scheduleResponse = await this.getUserSchedule(userEmail, freeBusyRequest);

		if (!scheduleResponse.value || scheduleResponse.value.length === 0) {
			return [];
		}

		const schedule = scheduleResponse.value[0];
		const availableSlots: Array<{ start: string; end: string }> = [];
		const start = new Date(startDate);
		const end = new Date(endDate);
		const intervalMs = durationMinutes * 60 * 1000;

		for (let current = new Date(start); current < end; current = new Date(current.getTime() + intervalMs)) {
			const slotEnd = new Date(current.getTime() + intervalMs);

			const isBusy = schedule.scheduleItems?.some((item) => {
				const itemStart = new Date(item.start.dateTime);
				const itemEnd = new Date(item.end.dateTime);
				return (
					(current >= itemStart && current < itemEnd) ||
					(slotEnd > itemStart && slotEnd <= itemEnd) ||
					(current <= itemStart && slotEnd >= itemEnd)
				);
			});

			if (!isBusy) {
				availableSlots.push({
					start: current.toISOString(),
					end: slotEnd.toISOString(),
				});
			}
		}

		return availableSlots;
	}
}
