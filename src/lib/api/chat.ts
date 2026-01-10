import { PUBLIC_N8N_CHAT_WH_URL } from '$env/static/public';

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
}

export interface ChatResponse {
    output?: string;
    response?: string;
    message?: string;
    error?: string;
    // n8n might return the data in different formats
    [key: string]: any;
}



export async function sendMessage(sessionId: string, message: string): Promise<string> {
    if (!PUBLIC_N8N_CHAT_WH_URL) {
        throw new Error('PUBLIC_N8N_CHAT_WH_URL is not set');
    }
    try {
        const response = await fetch(PUBLIC_N8N_CHAT_WH_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                sessionId,
                action: 'sendMessage',
                chatInput: message 
            }),
        });
        if (!response.ok) {
            throw new Error(`Failed to send message. Your Error Code: ${response.status}`);
        }
        const rawData = await response.json();
        
        // Log the response to help debug
        console.log('API Response:', rawData);
        
        // Handle array responses (n8n sometimes returns arrays)
        let data: ChatResponse;
        if (Array.isArray(rawData) && rawData.length > 0) {
            data = rawData[0] as ChatResponse;
        } else {
            data = rawData as ChatResponse;
        }
        
        // Extract the response message, handling different possible formats
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
    } catch (error: any) {
        console.error(error);
        throw error;
    }
}