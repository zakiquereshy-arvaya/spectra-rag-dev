export interface User {
	name: string;
	email: string;
}

export class CalendarAIHelper {
	constructor(_apiKey: string, _model: string = 'gpt-4o-mini') {}

	private normalizeName(name: string): string {
		return name
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	private isLikelySamePerson(nameA: string, nameB: string): boolean {
		const normalizedA = this.normalizeName(nameA);
		const normalizedB = this.normalizeName(nameB);

		if (!normalizedA || !normalizedB) {
			return false;
		}

		if (normalizedA === normalizedB) {
			return true;
		}

		if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) {
			return true;
		}

		const tokensA = new Set(normalizedA.split(' '));
		const tokensB = new Set(normalizedB.split(' '));
		const overlap = [...tokensA].filter((token) => tokensB.has(token)).length;
		const maxTokens = Math.max(tokensA.size, tokensB.size);

		return maxTokens > 0 && overlap / maxTokens >= 0.6;
	}

	async matchUserName(queryName: string, usersList: User[]): Promise<User | null> {
		if (!queryName || !queryName.trim()) {
			return null;
		}

		if (!usersList || usersList.length === 0) {
			return null;
		}

		const normalizedQuery = this.normalizeName(queryName);
		if (!normalizedQuery) {
			return null;
		}

		if (normalizedQuery.includes('@')) {
			const exactEmail = usersList.find(
				(user) => user.email.toLowerCase().trim() === normalizedQuery
			);
			return exactEmail || null;
		}

		const queryTokens = new Set(normalizedQuery.split(' '));
		const candidates = usersList.filter((user) => {
			const normalizedUser = this.normalizeName(user.name);
			if (!normalizedUser) return false;
			if (normalizedUser === normalizedQuery) return true;
			if (normalizedUser.includes(normalizedQuery) || normalizedQuery.includes(normalizedUser)) {
				return true;
			}
			const userTokens = new Set(normalizedUser.split(' '));
			const allTokensMatch = [...queryTokens].every((token) => userTokens.has(token));
			return allTokensMatch;
		});

		if (candidates.length === 1) {
			return candidates[0];
		}

		if (candidates.length > 1) {
			const suggestions = candidates.slice(0, 3).map((user) => `${user.name} <${user.email}>`);
			throw new Error(
				`User '${queryName}' is ambiguous. Please specify which person you mean. Candidates: ${suggestions.join(', ')}`
			);
		}

		return null;
	}

	async validateSender(
		senderName: string,
		senderEmail: string,
		usersList: User[]
	): Promise<User> {
		if (!senderEmail || !senderEmail.trim()) {
			throw new Error(
				'sender_email is REQUIRED. Please call get_users_with_name_and_email first ' +
					'to get the sender\'s email address, then provide it as sender_email parameter.'
			);
		}

		const senderEmailLower = senderEmail.toLowerCase().trim();

		let senderUserByEmail: User | null = null;
		for (const user of usersList) {
			const userEmail = (user.email || '').toLowerCase().trim();
			if (userEmail === senderEmailLower) {
				senderUserByEmail = user;
				break;
			}
		}

		if (!senderUserByEmail) {
			const availableEmails = usersList
				.filter((u) => u.email)
				.slice(0, 5)
				.map((u) => u.email);
			throw new Error(
				`Sender email '${senderEmail}' not found in the system. ` +
					`Please use get_users_with_name_and_email tool first to get a valid sender email address. ` +
					`Example emails found: ${availableEmails.slice(0, 3).join(', ')}`
			);
		}

		if (!senderName || !senderName.trim()) {
			return senderUserByEmail;
		}

		if (this.isLikelySamePerson(senderName, senderUserByEmail.name)) {
			return senderUserByEmail;
		}

		throw new Error(
			`Sender validation failed: sender_name '${senderName}' does not match ` +
				`the user associated with sender_email '${senderEmail}'. ` +
				`Expected name similar to '${senderUserByEmail.name}'. ` +
				`Please use get_users_with_name_and_email to get the correct sender information.`
		);
	}
}
