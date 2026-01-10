// Microsoft Graph API Types for Calendar and Events

export interface MicrosoftGraphEvent {
	id?: string;
	subject: string;
	body?: {
		contentType: 'text' | 'html';
		content: string;
	};
	start: {
		dateTime: string;
		timeZone: string;
	};
	end: {
		dateTime: string;
		timeZone: string;
	};
	location?: {
		displayName: string;
		locationType?: 'default' | 'conferenceRoom' | 'homeAddress' | 'businessAddress' | 'geoCoordinates' | 'streetAddress' | 'hotel' | 'restaurant' | 'localBusiness' | 'postalAddress';
	};
	attendees?: Array<{
		emailAddress: {
			address: string;
			name?: string;
		};
		type: 'required' | 'optional' | 'resource';
	}>;
	isAllDay?: boolean;
	isReminderOn?: boolean;
	reminderMinutesBeforeStart?: number;
	showAs?: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere' | 'unknown';
	importance?: 'low' | 'normal' | 'high';
	sensitivity?: 'normal' | 'personal' | 'private' | 'confidential';
	recurrence?: {
		pattern: {
			type: 'daily' | 'weekly' | 'absoluteMonthly' | 'relativeMonthly' | 'absoluteYearly' | 'relativeYearly';
			interval: number;
			daysOfWeek?: string[];
			dayOfMonth?: number;
			firstDayOfWeek?: string;
			index?: string;
			month?: number;
		};
		range: {
			type: 'endDate' | 'noEnd' | 'numbered';
			startDate: string;
			endDate?: string;
			numberOfOccurrences?: number;
		};
	};
}

export interface MicrosoftGraphCalendar {
	id: string;
	name: string;
	color?: string;
	canEdit?: boolean;
	canShare?: boolean;
	canViewPrivateItems?: boolean;
	owner?: {
		name: string;
		address: string;
	};
}

export interface MicrosoftGraphCalendarViewParams {
	startDateTime: string;
	endDateTime: string;
	$select?: string;
	$filter?: string;
	$orderby?: string;
	$top?: number;
}

export interface MicrosoftGraphFreeBusyRequest {
	schedules: string[];
	startTime: {
		dateTime: string;
		timeZone: string;
	};
	endTime: {
		dateTime: string;
		timeZone: string;
	};
	availabilityViewInterval?: number;
}

export interface MicrosoftGraphFreeBusyResponse {
	value: Array<{
		scheduleId: string;
		availabilityView: string;
		scheduleItems: Array<{
			status: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere' | 'unknown';
			start: {
				dateTime: string;
				timeZone: string;
			};
			end: {
				dateTime: string;
				timeZone: string;
			};
		}>;
	}>;
}

export interface CreateEventRequest {
	subject: string;
	start: string; // ISO 8601 datetime
	end: string; // ISO 8601 datetime
	timeZone?: string;
	location?: string;
	attendees?: string[]; // Email addresses
	body?: string;
	isAllDay?: boolean;
}
