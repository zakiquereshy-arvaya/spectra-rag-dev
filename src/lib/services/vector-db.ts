// Vector Database Service for Fireflies Transcripts
// Uses Railway PostgreSQL with pgvector extension for semantic search

import pg from 'pg';
import { CohereClientV2 } from 'cohere-ai';
import type { FirefliesTranscript } from './fireflies';

// ============================================================================
// Type Definitions
// ============================================================================

export interface SearchFilters {
	dateRange?: [Date, Date];
	participants?: string[];
	meetingType?: string;
}

export interface SearchOptions {
	limit?: number;
	searchChunks?: boolean;
}

export interface SearchResult {
	id: string;
	title: string;
	transcript_date: Date;
	similarity: number;
	excerpt: string;
	transcript_url: string;
	source: 'transcript' | 'chunk';
	chunk_topic?: string;
}

interface ChunkData {
	chunk_text: string;
	chunk_topic: string;
	speakers_in_chunk: string[];
	start_time: number;
	end_time: number;
}

// ============================================================================
// SQL Schema
// ============================================================================

const CREATE_EXTENSION_SQL = `CREATE EXTENSION IF NOT EXISTS vector;`;

const CREATE_TRANSCRIPTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS fireflies_transcripts (
    id TEXT PRIMARY KEY,
    title TEXT,
    transcript_date TIMESTAMP,
    duration_seconds INTEGER,
    host_email TEXT,
    organizer_email TEXT,
    participants TEXT[],
    fireflies_users TEXT[],
    calendar_type TEXT,
    meeting_link TEXT,
    transcript_url TEXT,
    audio_url TEXT,
    video_url TEXT,
    summary_keywords TEXT[],
    summary_action_items TEXT,
    summary_overview TEXT,
    summary_short_summary TEXT,
    summary_gist TEXT,
    summary_meeting_type TEXT,
    summary_topics_discussed TEXT[],
    sentiment_negative_pct FLOAT,
    sentiment_neutral_pct FLOAT,
    sentiment_positive_pct FLOAT,
    speakers JSONB,
    meeting_attendees JSONB,
    full_transcript_text TEXT,
    embedding vector(1024),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
`;

const CREATE_CHUNKS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS fireflies_chunks (
    id TEXT PRIMARY KEY,
    transcript_id TEXT REFERENCES fireflies_transcripts(id) ON DELETE CASCADE,
    chunk_index INTEGER,
    chunk_text TEXT,
    chunk_topic TEXT,
    speakers_in_chunk TEXT[],
    start_time FLOAT,
    end_time FLOAT,
    embedding vector(1024),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(transcript_id, chunk_index)
);
`;

const CREATE_INDEXES_SQL = [
	`CREATE INDEX IF NOT EXISTS idx_transcript_date ON fireflies_transcripts(transcript_date DESC);`,
	`CREATE INDEX IF NOT EXISTS idx_participants ON fireflies_transcripts USING GIN(participants);`,
	`CREATE INDEX IF NOT EXISTS idx_keywords ON fireflies_transcripts USING GIN(summary_keywords);`,
];

// IVFFlat indexes require data to exist first, so we create them conditionally
const CREATE_VECTOR_INDEXES_SQL = [
	`CREATE INDEX IF NOT EXISTS idx_transcript_embedding ON fireflies_transcripts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);`,
	`CREATE INDEX IF NOT EXISTS idx_chunk_embedding ON fireflies_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);`,
];

// ============================================================================
// Service Implementation
// ============================================================================

let poolInstance: pg.Pool | null = null;

export class VectorDBService {
	private pool: pg.Pool;
	private cohere: CohereClientV2;

	constructor(databaseUrl?: string, cohereApiKey?: string) {
		const env = typeof process !== 'undefined' ? process.env : {};
		const normalizeEnv = (value?: string) => value?.trim().replace(/^['"]|['"]$/g, '');
		const dbUrl = normalizeEnv(databaseUrl || env.VECTOR_DATABASE_URL);
		const apiKey = normalizeEnv(cohereApiKey || env.COHERE_API_KEY);
		const sslMode = normalizeEnv(env.PGSSLMODE);
		const urlSslMode = (() => {
			try {
				return dbUrl ? new URL(dbUrl).searchParams.get('sslmode') : null;
			} catch {
				return null;
			}
		})();
		const shouldDisableSsl = sslMode === 'disable' || urlSslMode === 'disable';

		if (!dbUrl) {
			throw new Error('Database URL is required. Set VECTOR_DATABASE_URL environment variable.');
		}
		if (!apiKey) {
			throw new Error('Cohere API key is required. Set COHERE_API_KEY environment variable.');
		}

		// Use singleton pool for connection reuse
		if (!poolInstance) {
			poolInstance = new pg.Pool({
				connectionString: dbUrl,
				ssl: shouldDisableSsl ? false : { rejectUnauthorized: false },
				max: 10,
				idleTimeoutMillis: 30000,
			});
		}
		this.pool = poolInstance;

		this.cohere = new CohereClientV2({
			token: apiKey,
		});
	}

	/**
	 * Initialize the database schema
	 * Creates pgvector extension, tables, and indexes
	 */
	async initialize(): Promise<void> {
		const client = await this.pool.connect();
		try {
			console.log('[VectorDB] Initializing database schema...');

			// Create pgvector extension
			await client.query(CREATE_EXTENSION_SQL);
			console.log('[VectorDB] pgvector extension enabled');

			// Create tables
			await client.query(CREATE_TRANSCRIPTS_TABLE_SQL);
			console.log('[VectorDB] fireflies_transcripts table ready');

			await client.query(CREATE_CHUNKS_TABLE_SQL);
			console.log('[VectorDB] fireflies_chunks table ready');

			// Create standard indexes
			for (const sql of CREATE_INDEXES_SQL) {
				await client.query(sql);
			}
			console.log('[VectorDB] Standard indexes created');

			// Check if we have enough data for IVFFlat indexes (need at least 100 rows)
			const countResult = await client.query(
				'SELECT COUNT(*) as count FROM fireflies_transcripts WHERE embedding IS NOT NULL'
			);
			const rowCount = parseInt(countResult.rows[0].count, 10);

			if (rowCount >= 100) {
				for (const sql of CREATE_VECTOR_INDEXES_SQL) {
					try {
						await client.query(sql);
					} catch (err: any) {
						// Index might already exist or not enough data
						if (!err.message?.includes('already exists')) {
							console.warn(`[VectorDB] Could not create vector index: ${err.message}`);
						}
					}
				}
				console.log('[VectorDB] Vector indexes created');
			} else {
				console.log(
					`[VectorDB] Skipping IVFFlat indexes (need 100+ rows, have ${rowCount}). Will use sequential scan.`
				);
			}

			console.log('[VectorDB] Database initialization complete');
		} catch (error: any) {
			console.error('[VectorDB] Initialization failed:', error.message);
			throw new Error(`Failed to initialize vector database: ${error.message}`);
		} finally {
			client.release();
		}
	}

	/**
	 * Clean and format transcript text from sentences array
	 * Groups consecutive sentences by speaker for readability
	 */
	cleanTranscriptText(
		sentences: Array<{ speaker_name: string; text: string }>
	): string {
		if (!sentences || sentences.length === 0) {
			return '';
		}

		const lines: string[] = [];
		let currentSpeaker = '';
		let currentTexts: string[] = [];

		for (const sentence of sentences) {
			const text = sentence.text?.trim();
			if (!text) continue;

			const speaker = sentence.speaker_name || 'Unknown';

			if (speaker !== currentSpeaker) {
				// Flush previous speaker's text
				if (currentSpeaker && currentTexts.length > 0) {
					lines.push(`${currentSpeaker}: ${currentTexts.join(' ')}`);
				}
				currentSpeaker = speaker;
				currentTexts = [text];
			} else {
				currentTexts.push(text);
			}
		}

		// Flush final speaker
		if (currentSpeaker && currentTexts.length > 0) {
			lines.push(`${currentSpeaker}: ${currentTexts.join(' ')}`);
		}

		return lines.join('\n\n');
	}

	/**
	 * Generate embedding vector using Cohere embed-english-v3.0
	 * @param text - Text to embed (truncated to 8000 chars if needed)
	 * @param inputType - 'search_document' for indexing, 'search_query' for queries
	 * @returns 1024-dimensional embedding vector
	 */
	async generateEmbedding(
		text: string,
		inputType: 'search_document' | 'search_query' = 'search_document'
	): Promise<number[]> {
		if (!text || text.trim().length === 0) {
			throw new Error('Cannot generate embedding for empty text');
		}

		// Truncate to 8000 chars to stay within model limits
		const truncatedText = text.length > 8000 ? text.substring(0, 8000) : text;

		try {
			const response = await this.cohere.embed({
				texts: [truncatedText],
				model: 'embed-english-v3.0',
				inputType,
				embeddingTypes: ['float'],
			});

			const embeddings = response.embeddings;
			if (embeddings && 'float' in embeddings && embeddings.float && embeddings.float.length > 0) {
				return embeddings.float[0];
			}

			throw new Error('No embeddings returned from Cohere');
		} catch (error: any) {
			console.error('[VectorDB] Embedding generation failed:', error.message);
			throw new Error(`Failed to generate embedding: ${error.message}`);
		}
	}

	/**
	 * Determine chunking strategy based on meeting duration
	 * @param durationSeconds - Meeting duration in seconds
	 * @returns Chunking strategy to use
	 */
	determineChunkingStrategy(
		durationSeconds: number
	): 'single' | 'speaker_turns' | 'chapters' {
		if (durationSeconds < 900) {
			// < 15 minutes: single embedding for whole transcript
			return 'single';
		} else if (durationSeconds < 1800) {
			// 15-30 minutes: chunk by speaker turns
			return 'speaker_turns';
		} else {
			// >= 30 minutes: use chapters if available
			return 'chapters';
		}
	}

	/**
	 * Create semantic chunks from transcript based on strategy
	 * Returns empty array for 'single' strategy (no chunking needed)
	 */
	createSemanticChunks(
		transcript: FirefliesTranscript,
		strategy: 'single' | 'speaker_turns' | 'chapters'
	): ChunkData[] {
		if (strategy === 'single') {
			return [];
		}

		const sentences = transcript.sentences || [];
		if (sentences.length === 0) {
			return [];
		}

		if (strategy === 'chapters') {
			// Try to use transcript chapters if available
			const chapters = transcript.summary?.transcript_chapters;
			if (chapters && Array.isArray(chapters) && chapters.length > 0) {
				return this.createChapterChunks(transcript, chapters);
			}
			// Fall back to speaker turns if no chapters
			console.log('[VectorDB] No chapters available, falling back to speaker_turns strategy');
		}

		// speaker_turns strategy (also fallback for chapters)
		return this.createSpeakerTurnChunks(transcript);
	}

	/**
	 * Create chunks based on transcript chapters
	 */
	private createChapterChunks(
		transcript: FirefliesTranscript,
		chapters: Array<string | { title?: string; gist?: string }>
	): ChunkData[] {
		const chunks: ChunkData[] = [];
		const sentences = transcript.sentences || [];

		// Chapters might be strings or objects depending on API response
		const chapterCount = chapters.length;
		const sentencesPerChapter = Math.ceil(sentences.length / chapterCount);

		for (let i = 0; i < chapterCount; i++) {
			const chapter = chapters[i];
			const chapterTitle =
				typeof chapter === 'string'
					? chapter
					: chapter?.title || chapter?.gist || `Chapter ${i + 1}`;

			const startIdx = i * sentencesPerChapter;
			const endIdx = Math.min(startIdx + sentencesPerChapter, sentences.length);
			const chapterSentences = sentences.slice(startIdx, endIdx);

			if (chapterSentences.length === 0) continue;

			const speakers = [...new Set(chapterSentences.map((s) => s.speaker_name).filter(Boolean))];
			const chunkText = this.cleanTranscriptText(chapterSentences);

			chunks.push({
				chunk_text: chunkText,
				chunk_topic: chapterTitle,
				speakers_in_chunk: speakers,
				start_time: chapterSentences[0]?.start_time || 0,
				end_time: chapterSentences[chapterSentences.length - 1]?.end_time || 0,
			});
		}

		return chunks;
	}

	/**
	 * Create chunks based on speaker turns (batches of 20 sentences)
	 */
	private createSpeakerTurnChunks(transcript: FirefliesTranscript): ChunkData[] {
		const SENTENCES_PER_CHUNK = 20;
		const chunks: ChunkData[] = [];
		const sentences = transcript.sentences || [];

		for (let i = 0; i < sentences.length; i += SENTENCES_PER_CHUNK) {
			const batchSentences = sentences.slice(i, i + SENTENCES_PER_CHUNK);
			if (batchSentences.length === 0) continue;

			const speakers = [...new Set(batchSentences.map((s) => s.speaker_name).filter(Boolean))];
			const chunkText = this.cleanTranscriptText(batchSentences);
			const chunkIndex = Math.floor(i / SENTENCES_PER_CHUNK);

			chunks.push({
				chunk_text: chunkText,
				chunk_topic: `Discussion segment ${chunkIndex + 1}`,
				speakers_in_chunk: speakers,
				start_time: batchSentences[0]?.start_time || 0,
				end_time: batchSentences[batchSentences.length - 1]?.end_time || 0,
			});
		}

		return chunks;
	}

	/**
	 * Upsert a transcript and its chunks into the database
	 * Generates embeddings and handles chunking automatically
	 */
	async upsertTranscript(transcript: FirefliesTranscript): Promise<void> {
		const client = await this.pool.connect();

		try {
			console.log(`[VectorDB] Upserting transcript: ${transcript.title} (${transcript.id})`);

			// Clean full transcript text
			const fullTranscriptText = this.cleanTranscriptText(transcript.sentences || []);

			// Build embedding text from key content
			const embeddingParts = [
				transcript.title,
				transcript.summary?.overview,
				transcript.summary?.short_summary,
				transcript.summary?.action_items,
				transcript.summary?.keywords?.join(', '),
				transcript.summary?.topics_discussed?.join(', '),
			].filter(Boolean);
			const embeddingText = embeddingParts.join('\n\n');

			// Generate main transcript embedding
			const embedding = await this.generateEmbedding(embeddingText, 'search_document');

			// Convert Unix timestamp to ISO date
			const transcriptDate = transcript.date
				? new Date(typeof transcript.date === 'number' ? transcript.date : parseInt(transcript.date as string, 10))
				: new Date();

			const rawDuration =
				typeof transcript.duration === 'number'
					? transcript.duration
					: Number(transcript.duration);
			const durationMinutes = Number.isFinite(rawDuration) ? rawDuration : 0;
			const durationSeconds = Math.round(durationMinutes * 60);

			// Upsert main transcript record
			await client.query(
				`INSERT INTO fireflies_transcripts (
					id, title, transcript_date, duration_seconds,
					host_email, organizer_email, participants, fireflies_users,
					calendar_type, meeting_link, transcript_url, audio_url, video_url,
					summary_keywords, summary_action_items, summary_overview,
					summary_short_summary, summary_gist, summary_meeting_type, summary_topics_discussed,
					sentiment_negative_pct, sentiment_neutral_pct, sentiment_positive_pct,
					speakers, meeting_attendees, full_transcript_text, embedding, updated_at
				) VALUES (
					$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
					$14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, NOW()
				)
				ON CONFLICT (id) DO UPDATE SET
					title = EXCLUDED.title,
					transcript_date = EXCLUDED.transcript_date,
					duration_seconds = EXCLUDED.duration_seconds,
					host_email = EXCLUDED.host_email,
					organizer_email = EXCLUDED.organizer_email,
					participants = EXCLUDED.participants,
					fireflies_users = EXCLUDED.fireflies_users,
					calendar_type = EXCLUDED.calendar_type,
					meeting_link = EXCLUDED.meeting_link,
					transcript_url = EXCLUDED.transcript_url,
					audio_url = EXCLUDED.audio_url,
					video_url = EXCLUDED.video_url,
					summary_keywords = EXCLUDED.summary_keywords,
					summary_action_items = EXCLUDED.summary_action_items,
					summary_overview = EXCLUDED.summary_overview,
					summary_short_summary = EXCLUDED.summary_short_summary,
					summary_gist = EXCLUDED.summary_gist,
					summary_meeting_type = EXCLUDED.summary_meeting_type,
					summary_topics_discussed = EXCLUDED.summary_topics_discussed,
					sentiment_negative_pct = EXCLUDED.sentiment_negative_pct,
					sentiment_neutral_pct = EXCLUDED.sentiment_neutral_pct,
					sentiment_positive_pct = EXCLUDED.sentiment_positive_pct,
					speakers = EXCLUDED.speakers,
					meeting_attendees = EXCLUDED.meeting_attendees,
					full_transcript_text = EXCLUDED.full_transcript_text,
					embedding = EXCLUDED.embedding,
					updated_at = NOW()`,
				[
					transcript.id,
					transcript.title,
					transcriptDate.toISOString(),
					durationSeconds,
					transcript.host_email || null,
					transcript.organizer_email || null,
					transcript.participants || [],
					transcript.fireflies_users || [],
					transcript.calendar_type || null,
					transcript.meeting_link || null,
					transcript.transcript_url || null,
					transcript.audio_url || null,
					transcript.video_url || null,
					transcript.summary?.keywords || [],
					transcript.summary?.action_items || null,
					transcript.summary?.overview || null,
					transcript.summary?.short_summary || null,
					transcript.summary?.gist || null,
					transcript.summary?.meeting_type || null,
					transcript.summary?.topics_discussed || [],
					transcript.analytics?.sentiments?.negative_pct || 0,
					transcript.analytics?.sentiments?.neutral_pct || 0,
					transcript.analytics?.sentiments?.positive_pct || 0,
					JSON.stringify(transcript.speakers || []),
					JSON.stringify(transcript.meeting_attendees || []),
					fullTranscriptText,
					`[${embedding.join(',')}]`,
				]
			);

			// Determine chunking strategy and create chunks if needed
			const strategy = this.determineChunkingStrategy(durationSeconds);
			console.log(`[VectorDB] Using chunking strategy: ${strategy} (duration: ${durationSeconds}s)`);

			if (strategy !== 'single') {
				const chunks = this.createSemanticChunks(transcript, strategy);

				// Delete existing chunks for this transcript
				await client.query('DELETE FROM fireflies_chunks WHERE transcript_id = $1', [
					transcript.id,
				]);

				// Insert new chunks
				for (let i = 0; i < chunks.length; i++) {
					const chunk = chunks[i];
					const chunkId = `${transcript.id}_chunk_${i}`;

					// Generate chunk embedding
					const chunkEmbedding = await this.generateEmbedding(
						chunk.chunk_text,
						'search_document'
					);

					await client.query(
						`INSERT INTO fireflies_chunks (
							id, transcript_id, chunk_index, chunk_text, chunk_topic,
							speakers_in_chunk, start_time, end_time, embedding
						) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
						ON CONFLICT (transcript_id, chunk_index) DO UPDATE SET
							chunk_text = EXCLUDED.chunk_text,
							chunk_topic = EXCLUDED.chunk_topic,
							speakers_in_chunk = EXCLUDED.speakers_in_chunk,
							start_time = EXCLUDED.start_time,
							end_time = EXCLUDED.end_time,
							embedding = EXCLUDED.embedding`,
						[
							chunkId,
							transcript.id,
							i,
							chunk.chunk_text,
							chunk.chunk_topic,
							chunk.speakers_in_chunk,
							chunk.start_time,
							chunk.end_time,
							`[${chunkEmbedding.join(',')}]`,
						]
					);
				}

				console.log(`[VectorDB] Created ${chunks.length} chunks for transcript`);
			}

			console.log(`[VectorDB] Successfully upserted transcript: ${transcript.title}`);
		} catch (error: any) {
			console.error(`[VectorDB] Failed to upsert transcript ${transcript.id}:`, error.message);
			throw new Error(`Failed to upsert transcript ${transcript.id}: ${error.message}`);
		} finally {
			client.release();
		}
	}

	/**
	 * Search transcripts using semantic similarity
	 * Optionally searches chunks for more granular results
	 */
	async searchTranscripts(
		query: string,
		filters?: SearchFilters,
		options?: SearchOptions
	): Promise<SearchResult[]> {
		const limit = options?.limit ?? 10;
		const searchChunks = options?.searchChunks ?? false;

		try {
			console.log(`[VectorDB] Searching for: "${query}" (limit: ${limit}, chunks: ${searchChunks})`);

			// Generate query embedding
			const queryEmbedding = await this.generateEmbedding(query, 'search_query');
			const embeddingStr = `[${queryEmbedding.join(',')}]`;

			// Build WHERE clauses
			const whereClauses: string[] = ['embedding IS NOT NULL'];
			const params: any[] = [embeddingStr];
			let paramIndex = 2;

			if (filters?.dateRange) {
				whereClauses.push(`transcript_date >= $${paramIndex} AND transcript_date <= $${paramIndex + 1}`);
				params.push(filters.dateRange[0].toISOString(), filters.dateRange[1].toISOString());
				paramIndex += 2;
			}

			if (filters?.participants && filters.participants.length > 0) {
				whereClauses.push(`participants && $${paramIndex}`);
				params.push(filters.participants);
				paramIndex += 1;
			}

			if (filters?.meetingType) {
				whereClauses.push(`summary_meeting_type = $${paramIndex}`);
				params.push(filters.meetingType);
				paramIndex += 1;
			}

			const whereClause = whereClauses.join(' AND ');

			// Search main transcripts
			const transcriptQuery = `
				SELECT
					id,
					title,
					transcript_date,
					1 - (embedding <=> $1) as similarity,
					COALESCE(summary_overview, summary_short_summary, LEFT(full_transcript_text, 500)) as excerpt,
					transcript_url
				FROM fireflies_transcripts
				WHERE ${whereClause}
				ORDER BY embedding <=> $1
				LIMIT $${paramIndex}
			`;
			params.push(limit);

			const transcriptResults = await this.pool.query(transcriptQuery, params);

			const results: SearchResult[] = transcriptResults.rows.map((row) => ({
				id: row.id,
				title: row.title,
				transcript_date: new Date(row.transcript_date),
				similarity: parseFloat(row.similarity),
				excerpt: row.excerpt || '',
				transcript_url: row.transcript_url || '',
				source: 'transcript' as const,
			}));

			// Optionally search chunks for more granular results
			if (searchChunks) {
				const chunkQuery = `
					SELECT
						c.id,
						c.transcript_id,
						c.chunk_topic,
						c.chunk_text,
						t.title,
						t.transcript_date,
						t.transcript_url,
						1 - (c.embedding <=> $1) as similarity
					FROM fireflies_chunks c
					JOIN fireflies_transcripts t ON c.transcript_id = t.id
					WHERE c.embedding IS NOT NULL
					ORDER BY c.embedding <=> $1
					LIMIT $2
				`;

				const chunkResults = await this.pool.query(chunkQuery, [embeddingStr, limit]);

				for (const row of chunkResults.rows) {
					results.push({
						id: row.id,
						title: row.title,
						transcript_date: new Date(row.transcript_date),
						similarity: parseFloat(row.similarity),
						excerpt: row.chunk_text?.substring(0, 500) || '',
						transcript_url: row.transcript_url || '',
						source: 'chunk' as const,
						chunk_topic: row.chunk_topic,
					});
				}

				// Sort combined results by similarity
				results.sort((a, b) => b.similarity - a.similarity);
			}

			console.log(`[VectorDB] Found ${results.length} results`);
			return results.slice(0, limit);
		} catch (error: any) {
			console.error('[VectorDB] Search failed:', error.message);
			throw new Error(`Search failed: ${error.message}`);
		}
	}

	/**
	 * Get a transcript by ID
	 */
	async getTranscript(transcriptId: string): Promise<any | null> {
		const result = await this.pool.query(
			'SELECT * FROM fireflies_transcripts WHERE id = $1',
			[transcriptId]
		);
		return result.rows[0] || null;
	}

	/**
	 * Get all chunks for a transcript
	 */
	async getTranscriptChunks(transcriptId: string): Promise<any[]> {
		const result = await this.pool.query(
			'SELECT * FROM fireflies_chunks WHERE transcript_id = $1 ORDER BY chunk_index',
			[transcriptId]
		);
		return result.rows;
	}

	/**
	 * Get transcript count
	 */
	async getTranscriptCount(): Promise<number> {
		const result = await this.pool.query('SELECT COUNT(*) as count FROM fireflies_transcripts');
		return parseInt(result.rows[0].count, 10);
	}

	/**
	 * Delete a transcript and its chunks
	 */
	async deleteTranscript(transcriptId: string): Promise<void> {
		await this.pool.query('DELETE FROM fireflies_transcripts WHERE id = $1', [transcriptId]);
		console.log(`[VectorDB] Deleted transcript: ${transcriptId}`);
	}

	/**
	 * Close the database connection pool
	 */
	async close(): Promise<void> {
		if (poolInstance) {
			await poolInstance.end();
			poolInstance = null;
			console.log('[VectorDB] Connection pool closed');
		}
	}
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new VectorDBService instance
 */
export function createVectorDBService(
	databaseUrl?: string,
	cohereApiKey?: string
): VectorDBService {
	return new VectorDBService(databaseUrl, cohereApiKey);
}
