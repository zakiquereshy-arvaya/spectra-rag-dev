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
    // Response might return data in different formats
    [key: string]: any;
}

/**
 * Send a message to the RAG agent
 */
export async function sendMessage(sessionId: string, message: string): Promise<string> {
    try {
        const response = await fetch('/spectra-job/api', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                sessionId,
                message,
            }),
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Failed to send message. Status: ${response.status}`);
        }
        
        const data: ChatResponse = await response.json();
        
        // Log the response to help debug
        console.log('RAG API Response:', data);
        
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
        console.error('Chat API error:', error);
        throw error;
    }
}