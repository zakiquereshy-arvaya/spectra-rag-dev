import OpenAI from 'openai';

export interface User {
	name: string;
	email: string;
}

export class CalendarAIHelper {
	private client: OpenAI;
	private model: string;
	private readonly minConfidenceName = 0.9;
	private readonly minConfidenceSender = 0.95;

	constructor(apiKey: string, model: string = 'gpt-4o-mini') {
		this.client = new OpenAI({
			apiKey: apiKey,
		});
		this.model = model;
	}

	async matchUserName(queryName: string, usersList: User[]): Promise<User | null> {
		if (!queryName || !queryName.trim()) {
			return null;
		}

		if (!usersList || usersList.length === 0) {
			return null;
		}

		try {
			const prompt = `You are a user name matching assistant. Given a query name and a list of users, 
find the best matching user. You must be STRICT to prevent false matches.

Query: "${queryName}"
Users: ${JSON.stringify(usersList, null, 2)}

Rules:
- Match possessive forms (e.g., "ryan's" → "Ryan Botindari") ONLY if unambiguous
- Match partial names (e.g., "zaki" → "Zaki Quereshy") ONLY if unique
- Match nicknames ONLY if obvious and unambiguous
- If multiple users could match, return null (do not guess)
- Confidence must be > 0.9 to return a match
- Return JSON: {"name": "...", "email": "...", "confidence": 0.0-1.0}
- If confidence < 0.9 or ambiguous, return: {"match": null, "reason": "..."}

Return ONLY valid JSON, no other text.`;

			const response = await this.client.chat.completions.create({
				model: this.model,
				messages: [
					{
						role: 'system',
						content: 'You are a strict user name matching assistant. Return only valid JSON.',
					},
					{
						role: 'user',
						content: prompt,
					},
				],
				temperature: 0.1,
				max_tokens: 200,
			});

			let resultText = '';
			const content = response.choices[0]?.message?.content;
			if (content) {
				resultText = content.trim();
			}

			if (!resultText) {
				console.warn(`No response from AI for name matching: ${queryName}`);
				return null;
			}

			if (resultText.startsWith('```')) {
				resultText = resultText.split('```')[1];
				if (resultText.startsWith('json')) {
					resultText = resultText.slice(4);
				}
				resultText = resultText.trim();
			}

			const result = JSON.parse(resultText);

			if (result.match === null) {
				console.log(`No match found for '${queryName}': ${result.reason || 'Unknown reason'}`);
				return null;
			}

			const confidence = result.confidence || 0.0;
			if (confidence < this.minConfidenceName) {
				console.log(
					`Match found for '${queryName}' but confidence ${confidence} < ${this.minConfidenceName}`
				);
				return null;
			}

			const matchedUser: User = {
				name: result.name,
				email: result.email,
			};

			console.log(`AI matched '${queryName}' → '${matchedUser.name}' (confidence: ${confidence})`);
			return matchedUser;
		} catch (error: any) {
			console.error(`AI name matching failed for '${queryName}':`, error);
			throw new Error(
				`Failed to match user name '${queryName}'. ` +
					`Please use get_users_with_name_and_email tool first to get the correct email address. ` +
					`Error: ${error.message || 'Unknown error'}`
			);
		}
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

		try {
			const prompt = `Validate that sender_email "${senderEmail}" belongs to a user 
whose name matches "${senderName}" (allowing for natural variations like possessive forms, 
nicknames, but must be the SAME person).

Found user by email: ${JSON.stringify(senderUserByEmail, null, 2)}
All users: ${JSON.stringify(usersList, null, 2)}

CRITICAL: 
- sender_email MUST exist in the users list (already verified)
- sender_name MUST match the user associated with sender_email
- Be strict - if uncertain, return valid: false
- Confidence must be > 0.95 to return valid: true

Return JSON: {"name": "...", "email": "...", "valid": true/false, "confidence": 0.0-1.0}
Return ONLY valid JSON, no other text.`;

			const response = await this.client.chat.completions.create({
				model: this.model,
				messages: [
					{
						role: 'system',
						content: 'You are a strict sender validation assistant. Return only valid JSON.',
					},
					{
						role: 'user',
						content: prompt,
					},
				],
				temperature: 0.1,
				max_tokens: 200,
			});

			let resultText = '';
			const content = response.choices[0]?.message?.content;
			if (content) {
				resultText = content.trim();
			}

			if (!resultText) {
				console.warn('AI validation response empty, using email-based match');
				return senderUserByEmail;
			}

			if (resultText.startsWith('```')) {
				resultText = resultText.split('```')[1];
				if (resultText.startsWith('json')) {
					resultText = resultText.slice(4);
				}
				resultText = resultText.trim();
			}

			const result = JSON.parse(resultText);

			const isValid = result.valid || false;
			const confidence = result.confidence || 0.0;

			if (!isValid || confidence < this.minConfidenceSender) {
				throw new Error(
					`Sender validation failed: sender_name '${senderName}' does not match ` +
						`the user associated with sender_email '${senderEmail}'. ` +
						`Confidence: ${confidence}. ` +
						`Please use get_users_with_name_and_email to get the correct sender information.`
				);
			}

			const validatedUser: User = {
				name: result.name || senderUserByEmail.name,
				email: result.email || senderEmail,
			};

			console.log(
				`AI validated sender '${senderName}' with email '${senderEmail}' (confidence: ${confidence})`
			);
			return validatedUser;
		} catch (error: any) {
			if (error.message?.includes('Sender validation failed')) {
				throw error;
			}
			console.error(`AI sender validation failed:`, error);
			console.warn('AI validation failed, using email-based match');
			return senderUserByEmail;
		}
	}
}
