// Time Entry Types for Billi Hybrid Implementation

export interface TimeEntryInput {
	message: string;
	userName: string;
	userEmail?: string;
	localTimestamp: string;
}

export interface ExtractedTimeData {
	tasks_completed: string;
	hours: number;
	billable: boolean;
	description?: string;
}

export interface ExtractedEntityData {
	employee_name: string;
	customer_name: string;
}

export interface TimeEntry {
	employee_name: string;
	employee_qbo_id: string;
	customer_name: string;
	customer_qbo_id: string;
	tasks_completed: string;
	hours: number;
	billable: boolean;
	entry_date: string;
	submitted_by: string;
	submitted_at: string;
}

export interface TimeEntryResult {
	success: boolean;
	timeEntry?: TimeEntry;
	error?: string;
	extractedData?: {
		timeData: ExtractedTimeData;
		entityData: ExtractedEntityData;
	};
}

// Response from simplified n8n webhook
export interface N8nTimeEntryResponse {
	success: boolean;
	quickbooks_response?: {
		id: string;
		time_activity_id: string;
	};
	monday_response?: {
		updated: boolean;
		item_id: string;
	};
	error?: string;
}
