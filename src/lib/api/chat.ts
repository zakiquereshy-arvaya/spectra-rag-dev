import { PUBLIC_N8N_CHAT_WH_URL } from '$env/static/public';
import { fetchWithRetry } from '$lib/utils/retry';

export interface ToolResultData {
	type: 'availability' | 'booking' | 'time_entry';
	data: Record<string, any>;
}

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
	timestamp: string;
	toolResult?: ToolResultData;
	suggestions?: Array<{ label: string; action: string }>;
}

export interface ChatResponse {
	output?: string;
	response?: string;
	message?: string;
	error?: string;
}

export interface SendMessageOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
}

export async function sendMessage(
	sessionId: string,
	message: string,
	options: SendMessageOptions = {}
): Promise<string> {
	if (!PUBLIC_N8N_CHAT_WH_URL) {
		throw new Error('PUBLIC_N8N_CHAT_WH_URL is not set');
	}

	const { signal, timeoutMs = 60000 } = options;

	const response = await fetchWithRetry(
		PUBLIC_N8N_CHAT_WH_URL,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				sessionId,
				action: 'sendMessage',
				chatInput: message,
			}),
		},
		{
			signal,
			timeoutMs,
			maxRetries: 3,
			onRetry: (error, attempt, delayMs) => {
				console.warn(`Chat API retry attempt ${attempt} after ${delayMs}ms:`, error.message);
			},
		}
	);

	if (!response.ok) {
		throw new Error(`Failed to send message. Error Code: ${response.status}`);
	}

	const rawData = await response.json();

	// Handle array responses (n8n sometimes returns arrays)
	let data: ChatResponse;
	if (Array.isArray(rawData) && rawData.length > 0) {
		data = rawData[0] as ChatResponse;
	} else {
		data = rawData as ChatResponse;
	}

	// Check for error in response
	if (data.error) {
		throw new Error(data.error);
	}

	// Try different possible response fields
	const responseText = data.output || data.response || data.message;

	if (!responseText) {
		console.warn('Unexpected response format:', data);
		return 'No response received';
	}

	return responseText;
}
