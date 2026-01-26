import pg from 'pg';

const DOC_BATCH_SIZE = 200;
const CHUNK_BATCH_SIZE = 500;

const buildPlaceholders = (rows: any[], cols: number) => {
	const placeholders: string[] = [];
	let paramIndex = 1;
	for (let i = 0; i < rows.length; i += 1) {
		const rowPlaceholders = [];
		for (let c = 0; c < cols; c += 1) {
			rowPlaceholders.push(`$${paramIndex++}`);
		}
		placeholders.push(`(${rowPlaceholders.join(', ')})`);
	}
	return placeholders.join(', ');
};

const flattenRows = (rows: any[][]) => rows.flat();

const main = async () => {
	const databaseUrl = process.env.VECTOR_DATABASE_URL;

	if (!databaseUrl) {
		console.error('Missing VECTOR_DATABASE_URL');
		process.exit(1);
	}

	const pool = new pg.Pool({
		connectionString: databaseUrl,
		ssl: { rejectUnauthorized: false },
	});

	try {
		const transcripts = await pool.query(
			`SELECT
				id,
				title,
				transcript_date,
				transcript_url,
				participants,
				fireflies_users,
				summary_keywords,
				summary_action_items,
				summary_overview
			FROM fireflies_transcripts`
		);

		console.log(`Found ${transcripts.rows.length} transcripts to index.`);
		let transcriptCount = 0;

		for (const row of transcripts.rows) {
			const metadata = {
				participants: row.participants || [],
				fireflies_users: row.fireflies_users || [],
				summary_keywords: row.summary_keywords || [],
				summary_action_items: row.summary_action_items || null,
				summary_overview: row.summary_overview || null,
				source: 'fireflies',
			};

			await pool.query(
				`INSERT INTO documents (id, title, source_type, external_url, updated_at, metadata)
				 VALUES ($1, $2, 'fireflies', $3, NOW(), $4)
				 ON CONFLICT (id) DO UPDATE SET
				 title = EXCLUDED.title,
				 external_url = EXCLUDED.external_url,
				 updated_at = NOW(),
				 metadata = EXCLUDED.metadata`,
				[row.id, row.title, row.transcript_url, metadata]
			);

			transcriptCount += 1;
			if (transcriptCount % 25 === 0 || transcriptCount === transcripts.rows.length) {
				console.log(`Indexed transcripts: ${transcriptCount}/${transcripts.rows.length}`);
			}
		}

		const chunks = await pool.query(
			`SELECT
				id,
				transcript_id,
				chunk_index,
				chunk_text,
				chunk_topic,
				embedding
			FROM fireflies_chunks`
		);

		console.log(`Found ${chunks.rows.length} chunks to index.`);
		let chunkCount = 0;

		for (const chunk of chunks.rows) {
			await pool.query(
				`INSERT INTO chunks (
					id, doc_id, section, order_index, content, embedding, updated_at, metadata
				) VALUES (
					$1, $2, $3, $4, $5, $6, NOW(), $7
				)
				ON CONFLICT (id) DO UPDATE SET
					section = EXCLUDED.section,
					order_index = EXCLUDED.order_index,
					content = EXCLUDED.content,
					embedding = EXCLUDED.embedding,
					metadata = EXCLUDED.metadata`,
				[
					chunk.id,
					chunk.transcript_id,
					chunk.chunk_topic,
					chunk.chunk_index,
					chunk.chunk_text,
					chunk.embedding,
					{ source: 'fireflies' },
				]
			);

			chunkCount += 1;
			if (chunkCount % 200 === 0 || chunkCount === chunks.rows.length) {
				console.log(`Indexed chunks: ${chunkCount}/${chunks.rows.length}`);
			}
		}

		console.log('Fireflies data indexed into RAG schema.');
	} catch (error: any) {
		console.error('Indexing failed:', error.message);
		process.exit(1);
	} finally {
		await pool.end();
	}
};

main();
