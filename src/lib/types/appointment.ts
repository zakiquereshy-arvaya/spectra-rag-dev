
export interface AppointmentSlot {
	start: string; // ISO 8601 datetime
	end: string; // ISO 8601 datetime
	available: boolean;
}

export interface AppointmentBookingRequest {
	subject: string;
	start: string; // ISO 8601 datetime
	end: string; // ISO 8601 datetime
	timeZone?: string;
	location?: string;
	attendees?: string[]; // Email addresses
	description?: string;
	duration?: number; // minutes
}

export interface AppointmentBookingResponse {
	success: boolean;
	eventId?: string;
	event?: {
		id: string;
		subject: string;
		start: string;
		end: string;
		webLink?: string;
	};
	error?: string;
}

export interface AvailableSlotsRequest {
	startDate: string; // ISO 8601 date
	endDate: string; // ISO 8601 date
	duration?: number; // minutes, default 30
	timeZone?: string;
	calendarId?: string; // Optional: specific calendar
}

export interface AvailableSlotsResponse {
	slots: AppointmentSlot[];
	timeZone: string;
}
