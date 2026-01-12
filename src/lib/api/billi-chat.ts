import { fetchWithRetry } from '$lib/utils/retry';

export interface BilliChatResponse {
	output?: string;
	error?: string;
	sessionId?: string;
}

export interface SendBilliMessageOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
	userName?: string;
}

export async function sendBilliMessage(
	sessionId: string,
	message: string,
	options: SendBilliMessageOptions = {}
): Promise<string> {
	const { signal, timeoutMs = 60000, userName } = options;

	const response = await fetchWithRetry(
		'/billi/api',
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				sessionId,
				message,
				userName,
			}),
		},
		{
			signal,
			timeoutMs,
			maxRetries: 3,
			onRetry: (error, attempt, delayMs) => {
				console.warn(`Billi API retry attempt ${attempt} after ${delayMs}ms:`, error.message);
			},
		}
	);

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
		throw new Error(errorData.error || `Failed to send message. Status: ${response.status}`);
	}

	const data: BilliChatResponse = await response.json();

	if (data.error) {
		throw new Error(data.error);
	}

	if (!data.output) {
		console.warn('Unexpected response format:', data);
		return 'No response received from Billi';
	}

	return data.output;
}
