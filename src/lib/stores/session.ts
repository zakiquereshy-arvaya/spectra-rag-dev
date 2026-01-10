function generateSessionId(): string {
    return crypto.randomUUID();
}
function getSessionId(): string {
	if (typeof window === 'undefined') {
		// Server-side: return a temporary ID
		return 'temp-session';
	}

	const stored = localStorage.getItem('chat-session-id');
	if (stored) {
		return stored;
	}

	const newSessionId = generateSessionId();
	localStorage.setItem('chat-session-id', newSessionId);
	return newSessionId;
}

export function createSessionStore() {
	let _sessionId = getSessionId();

	return {
		get id() {
			return _sessionId;
		},
		reset() {
			_sessionId = generateSessionId();
			if (typeof window !== 'undefined') {
				localStorage.setItem('chat-session-id', _sessionId);
			}
		},
	};
}

// Export a singleton instance
export const sessionStore = createSessionStore();