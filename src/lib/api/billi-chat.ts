import type { ChatMessage } from './chat';

export interface BilliChatResponse {
	output?: string;
	error?: string;
	sessionId?: string;
}

export async function sendBilliMessage(sessionId: string, message: string, userName?: string): Promise<string> {
	try {
		const response = await fetch('/billi/api', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ 
				sessionId,
				message,
				userName
			}),
		});

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
	} catch (error: any) {
		console.error('Billi chat error:', error);
		throw error;
	}
}
