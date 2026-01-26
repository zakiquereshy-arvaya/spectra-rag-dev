// Fireflies.ai GraphQL API Service for Transcript Fetching

const FIREFLIES_API_ENDPOINT = 'https://api.fireflies.ai/graphql';

// ============================================================================
// Type Definitions
// ============================================================================

export interface FirefliesSentiment {
	negative_pct: number;
	neutral_pct: number;
	positive_pct: number;
}

export interface FirefliesAnalytics {
	sentiments: FirefliesSentiment;
}

export interface FirefliesSpeaker {
	id: string;
	name: string;
}

export interface FirefliesAttendee {
	displayName: string;
	email: string;
	name: string;
}

export interface FirefliesSentence {
	index: number;
	speaker_name: string;
	speaker_id: number;
	text: string;
	start_time: number;
	end_time: number;
}

export interface FirefliesSummary {
	keywords: string[];
	action_items: string[];
	overview: string;
	shorthand_bullet: string;
	gist: string;
	short_summary: string;
	meeting_type: string;
	topics_discussed: string[];
	transcript_chapters: string[];
}

export interface FirefliesTranscript {
	// Core identifiers
	id: string;
	title: string;
	date: string;
	duration: number;

	// Meeting metadata
	host_email: string;
	organizer_email: string;
	participants: string[];
	fireflies_users: string[];
	calendar_type: string;
	meeting_link: string;

	// URLs for reference
	transcript_url: string;
	audio_url: string;
	video_url: string;

	// Summary (for embedding)
	summary: FirefliesSummary;

	// Analytics
	analytics: FirefliesAnalytics;

	// Speakers metadata
	speakers: FirefliesSpeaker[];

	// Meeting attendees
	meeting_attendees: FirefliesAttendee[];

	// Sentences (for full transcript + chunking)
	sentences: FirefliesSentence[];
}

interface GraphQLResponse<T> {
	data?: T;
	errors?: Array<{
		message: string;
		locations?: Array<{ line: number; column: number }>;
		path?: string[];
		extensions?: Record<string, unknown>;
	}>;
}

interface TranscriptsQueryResponse {
	transcripts: FirefliesTranscript[];
}

interface TranscriptQueryResponse {
	transcript: FirefliesTranscript;
}

// ============================================================================
// GraphQL Queries
// ============================================================================

const TRANSCRIPT_FIELDS = `
	# Core identifiers
	id
	title
	date
	duration

	# Meeting metadata
	host_email
	organizer_email
	participants
	fireflies_users
	calendar_type
	meeting_link

	# URLs for reference
	transcript_url
	audio_url
	video_url

	# Summary (CRITICAL - this gets embedded)
	summary {
		keywords
		action_items
		overview
		shorthand_bullet
		gist
		short_summary
		meeting_type
		topics_discussed
		transcript_chapters
	}

	# Analytics
	analytics {
		sentiments {
			negative_pct
			neutral_pct
			positive_pct
		}
	}

	# Speakers metadata
	speakers {
		id
		name
	}

	# Meeting attendees
	meeting_attendees {
		displayName
		email
		name
	}

	# Sentences (for full transcript + chunking)
	sentences {
		index
		speaker_name
		speaker_id
		text
		start_time
		end_time
	}
`;

const TRANSCRIPTS_QUERY = `
	query Transcripts($limit: Int, $skip: Int) {
		transcripts(limit: $limit, skip: $skip) {
			${TRANSCRIPT_FIELDS}
		}
	}
`;

const TRANSCRIPT_BY_ID_QUERY = `
	query Transcript($transcriptId: String!) {
		transcript(id: $transcriptId) {
			${TRANSCRIPT_FIELDS}
		}
	}
`;


export class FirefliesService {
	private apiKey: string;
	private maxRetries: number;
	private baseDelay: number;

	constructor(options?: { apiKey?: string; maxRetries?: number; baseDelay?: number }) {
		const env = typeof process !== 'undefined' ? process.env : {};
		const normalizeEnv = (value?: string) => value?.trim().replace(/^['"]|['"]$/g, '');
		this.apiKey = options?.apiKey || normalizeEnv(env.FF_API_KEY) || '';
		this.maxRetries = options?.maxRetries ?? 3;
		this.baseDelay = options?.baseDelay ?? 1000;

		if (!this.apiKey) {
			throw new Error('Fireflies API key is required. Set FF_API_KEY environment variable.');
		}
	}

	/**
	 * Execute a GraphQL request with retry logic for rate limiting
	 */
	private async executeQuery<T>(
		query: string,
		variables: Record<string, unknown> = {}
	): Promise<T> {
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			try {
				const response = await fetch(FIREFLIES_API_ENDPOINT, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${this.apiKey}`,
					},
					body: JSON.stringify({ query, variables }),
				});

				// Handle rate limiting with exponential backoff
				if (response.status === 429) {
					const retryAfter = response.headers.get('Retry-After');
					const delay = retryAfter
						? parseInt(retryAfter, 10) * 1000
						: this.baseDelay * Math.pow(2, attempt);

					if (attempt < this.maxRetries) {
						console.warn(
							`[Fireflies] Rate limited. Retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`
						);
						await this.sleep(delay);
						continue;
					}
					throw new Error(`Rate limited after ${this.maxRetries} retries`);
				}

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(
						`Fireflies API HTTP error (${response.status}): ${errorText || response.statusText}`
					);
				}

				const result: GraphQLResponse<T> = await response.json();

				// Check for GraphQL errors
				if (result.errors && result.errors.length > 0) {
					const errorMessages = result.errors.map((e) => e.message).join('; ');
					const firstError = result.errors[0];
					const metadata = firstError?.extensions?.metadata as
						| Record<string, unknown>
						| undefined;
					const fieldDetails = Array.isArray(metadata?.fields) ? metadata?.fields : null;
					const detailSuffix = fieldDetails
						? ` (fields: ${JSON.stringify(fieldDetails)})`
						: '';

					throw new Error(`Fireflies GraphQL error: ${errorMessages}${detailSuffix}`);
				}

				if (!result.data) {
					throw new Error('Fireflies API returned no data');
				}

				return result.data;
			} catch (error: any) {
				lastError = error;

				// Retry on network errors
				if (
					attempt < this.maxRetries &&
					(error.name === 'TypeError' || error.message?.includes('fetch'))
				) {
					const delay = this.baseDelay * Math.pow(2, attempt);
					console.warn(
						`[Fireflies] Network error. Retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`
					);
					await this.sleep(delay);
					continue;
				}

				throw error;
			}
		}

		throw lastError || new Error('Unexpected error in Fireflies API request');
	}

	/**
	 * Sleep helper for retry delays
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Fetch a single transcript by ID
	 * @param transcriptId - The Fireflies transcript ID
	 * @returns The transcript with all fields populated
	 * @throws Error if transcript not found or API fails
	 */
	async fetchTranscript(transcriptId: string): Promise<FirefliesTranscript> {
		console.log(`[Fireflies] Fetching transcript: ${transcriptId}`);

		try {
			const data = await this.executeQuery<TranscriptQueryResponse>(TRANSCRIPT_BY_ID_QUERY, {
				transcriptId,
			});

			if (!data.transcript) {
				throw new Error(`Transcript not found: ${transcriptId}`);
			}

			console.log(`[Fireflies] Successfully fetched transcript: ${data.transcript.title}`);
			return data.transcript;
		} catch (error: any) {
			const message = error.message || 'Unknown error';
			throw new Error(`Failed to fetch transcript ${transcriptId}: ${message}`);
		}
	}

	/**
	 * Fetch all transcripts using AsyncGenerator for memory-efficient streaming
	 * Automatically handles pagination until all results are retrieved
	 * @param options - Optional configuration for batch size
	 * @yields FirefliesTranscript objects one at a time
	 */
	async *fetchAllTranscripts(options?: {
		batchSize?: number;
	}): AsyncGenerator<FirefliesTranscript> {
		const requestedBatchSize = options?.batchSize ?? 50;
		const batchSize = Math.min(requestedBatchSize, 50);
		let skip = 0;
		let totalFetched = 0;
		let hasMore = true;

		console.log(`[Fireflies] Starting to fetch all transcripts (batch size: ${batchSize})`);

		while (hasMore) {
			console.log(`[Fireflies] Fetching batch at offset ${skip}...`);

			const data = await this.executeQuery<TranscriptsQueryResponse>(TRANSCRIPTS_QUERY, {
				limit: batchSize,
				skip,
			});

			const transcripts = data.transcripts || [];
			const batchCount = transcripts.length;

			if (batchCount === 0) {
				hasMore = false;
				console.log(`[Fireflies] No more transcripts. Total fetched: ${totalFetched}`);
				break;
			}

			for (const transcript of transcripts) {
				yield transcript;
			}

			totalFetched += batchCount;
			skip += batchSize;

			console.log(`[Fireflies] Fetched ${totalFetched} transcripts...`);

			// If we got fewer than the batch size, we've reached the end
			if (batchCount < batchSize) {
				hasMore = false;
				console.log(`[Fireflies] Reached end of transcripts. Total: ${totalFetched}`);
			}
		}
	}

	/**
	 * Fetch the N most recent transcripts
	 * Useful for incremental updates or checking latest meetings
	 * @param limit - Maximum number of transcripts to return
	 * @returns Array of transcripts, most recent first
	 */
	async fetchRecentTranscripts(limit: number): Promise<FirefliesTranscript[]> {
		console.log(`[Fireflies] Fetching ${limit} most recent transcripts`);

		const data = await this.executeQuery<TranscriptsQueryResponse>(TRANSCRIPTS_QUERY, {
			limit,
			skip: 0,
		});

		const transcripts = data.transcripts || [];
		console.log(`[Fireflies] Retrieved ${transcripts.length} recent transcripts`);

		return transcripts;
	}

	/**
	 * Fetch transcripts in batches and return as array
	 * Alternative to AsyncGenerator when you need all results at once
	 * @param options - Optional configuration for batch size and max results
	 * @returns Array of all transcripts
	 */
	async fetchAllTranscriptsAsArray(options?: {
		batchSize?: number;
		maxResults?: number;
	}): Promise<FirefliesTranscript[]> {
		const results: FirefliesTranscript[] = [];
		const maxResults = options?.maxResults ?? Infinity;

		for await (const transcript of this.fetchAllTranscripts({ batchSize: options?.batchSize })) {
			results.push(transcript);
			if (results.length >= maxResults) {
				console.log(`[Fireflies] Reached max results limit: ${maxResults}`);
				break;
			}
		}

		return results;
	}
}

// ============================================================================
// Default Export
// ============================================================================

/**
 * Create a new FirefliesService instance with default configuration
 */
export function createFirefliesService(options?: {
	apiKey?: string;
	maxRetries?: number;
	baseDelay?: number;
}): FirefliesService {
	return new FirefliesService(options);
}
