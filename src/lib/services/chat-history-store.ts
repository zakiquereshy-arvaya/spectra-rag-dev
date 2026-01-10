// Simple in-memory chat history store per session
import type { ChatMessageV2 } from 'cohere-ai/api';

const chatHistories = new Map<string, ChatMessageV2[]>();

export function getChatHistory(sessionId: string): ChatMessageV2[] {
	return chatHistories.get(sessionId) || [];
}

export function setChatHistory(sessionId: string, history: ChatMessageV2[]): void {
	chatHistories.set(sessionId, history);
}

export function clearChatHistory(sessionId: string): void {
	chatHistories.delete(sessionId);
}
