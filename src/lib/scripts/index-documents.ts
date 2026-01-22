import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { CohereClientV2 } from 'cohere-ai';

type InputDoc = {
	id: string;
	title?: string;
	source_type?: string;
	external_url?: string;
	version?: string;
	product?: string;
	language?: string;
	tenant_id?: string;
	content: string;
	metadata?: Record<string, unknown>;
};

type ChunkRecord = {
	id: string;
	doc_id: string;
	section: string;
	order_index: number;
	content: string;
	language?: string;
	version?: string;
	product?: string;
	tenant_id?: string;
	metadata?: Record<string, unknown>;
};

type IndexConfig = {
	chunkSizeTokens: number;
	overlapTokens: number;
	embedBatchSize: number;
};

const DEFAULT_CONFIG: IndexConfig = {
	chunkSizeTokens: 300,
	overlapTokens: 40,
	embedBatchSize: 48,
};

const estimateTokens = (text: string): number => {
	const words = text.trim().split(/\s+/).filter(Boolean);
	return words.length;
};

const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

const splitByHeadings = (content: string): Array<{ section: string; text: string }> => {
	const lines = content.split('\n');
	const sections: Array<{ section: string; text: string }> = [];
	let currentSection = 'General';
	let buffer: string[] = [];

	const flush = () => {
		const text = normalizeWhitespace(buffer.join('\n'));
		if (text.length > 0) {
			sections.push({ section: currentSection, text });
		}
		buffer = [];
	};

	for (const line of lines) {
		const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
		if (headingMatch) {
			flush();
			currentSection = headingMatch[1].trim();
		} else {
			buffer.push(line);
		}
	}

	flush();
	return sections.length > 0 ? sections : [{ section: 'General', text: normalizeWhitespace(content) }];
};

const splitIntoChunks = (section: string, text: string, config: IndexConfig): string[] => {
	const paragraphs = text.split(/\n{2,}/).map((p) => normalizeWhitespace(p)).filter(Boolean);
	const chunks: string[] = [];
	let current: string[] = [];
	let currentTokens = 0;

	const pushChunk = () => {
		const chunkText = normalizeWhitespace(current.join('\n'));
		if (chunkText.length > 0) {
			chunks.push(chunkText);
		}
	};

	for (const paragraph of paragraphs) {
		const paragraphTokens = estimateTokens(paragraph);

		if (currentTokens + paragraphTokens > config.chunkSizeTokens && current.length > 0) {
			pushChunk();
			const overlapWords = current.join(' ').split(/\s+/).slice(-config.overlapTokens);
			current = overlapWords.length > 0 ? [overlapWords.join(' ')] : [];
			currentTokens = estimateTokens(current.join(' '));
		}

		current.push(paragraph);
		currentTokens += paragraphTokens;
	}

	if (current.length > 0) {
		pushChunk();
	}

	return chunks;
};

const chunkDocument = (doc: InputDoc, config: IndexConfig): ChunkRecord[] => {
	const sections = splitByHeadings(doc.content);
	const records: ChunkRecord[] = [];

	for (const section of sections) {
		const chunkTexts = splitIntoChunks(section.section, section.text, config);
		for (let i = 0; i < chunkTexts.length; i += 1) {
			const chunkText = chunkTexts[i];
			const chunkId = crypto
				.createHash('sha256')
				.update(`${doc.id}:${section.section}:${i}:${chunkText.slice(0, 50)}`)
				.digest('hex');

			records.push({
				id: chunkId,
				doc_id: doc.id,
				section: section.section,
				order_index: i,
				content: chunkText,
				language: doc.language,
				version: doc.version,
				product: doc.product,
				tenant_id: doc.tenant_id,
				metadata: doc.metadata || {},
			});
		}
	}

	return records;
};

const parseArgs = (argv: string[]): Record<string, string> => {
	const args: Record<string, string> = {};
	for (const arg of argv) {
		if (arg.startsWith('--')) {
			const [key, value] = arg.slice(2).split('=');
			if (key && value !== undefined) {
				args[key] = value;
			}
		}
	}
	return args;
};

const main = async () => {
	const args = parseArgs(process.argv.slice(2));
	const inputPath = args.input;
	if (!inputPath) {
		console.error('Usage: bun run src/lib/scripts/index-documents.ts --input=path/to/docs.json');
		process.exit(1);
	}

	const databaseUrl = process.env.VECTOR_DATABASE_URL;
	const cohereApiKey = process.env.COHERE_API_KEY;

	if (!databaseUrl || !cohereApiKey) {
		console.error('Missing required environment variables:');
		if (!databaseUrl) console.error('  - VECTOR_DATABASE_URL');
		if (!cohereApiKey) console.error('  - COHERE_API_KEY');
		process.exit(1);
	}

	const config: IndexConfig = {
		chunkSizeTokens: Number(args.chunkSizeTokens || DEFAULT_CONFIG.chunkSizeTokens),
		overlapTokens: Number(args.overlapTokens || DEFAULT_CONFIG.overlapTokens),
		embedBatchSize: Number(args.embedBatchSize || DEFAULT_CONFIG.embedBatchSize),
	};

	const absolutePath = path.resolve(inputPath);
	const raw = await fs.readFile(absolutePath, 'utf-8');
	const docs = JSON.parse(raw) as InputDoc[];

	const pool = new pg.Pool({
		connectionString: databaseUrl,
		ssl: { rejectUnauthorized: false },
	});

	const cohere = new CohereClientV2({ token: cohereApiKey });

	try {
		for (const doc of docs) {
			if (!doc.id || !doc.content) continue;

			await pool.query(
				`INSERT INTO documents (id, title, source_type, external_url, version, product, updated_at, metadata)
				 VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
				 ON CONFLICT (id) DO UPDATE SET
				 title = EXCLUDED.title,
				 source_type = EXCLUDED.source_type,
				 external_url = EXCLUDED.external_url,
				 version = EXCLUDED.version,
				 product = EXCLUDED.product,
				 updated_at = NOW(),
				 metadata = EXCLUDED.metadata`,
				[
					doc.id,
					doc.title || null,
					doc.source_type || null,
					doc.external_url || null,
					doc.version || null,
					doc.product || null,
					doc.metadata || {},
				]
			);

			const chunkRecords = chunkDocument(doc, config);

			for (let i = 0; i < chunkRecords.length; i += config.embedBatchSize) {
				const batch = chunkRecords.slice(i, i + config.embedBatchSize);
				const texts = batch.map((c) => c.content);
				const embedResponse = await cohere.embed({
					texts,
					model: 'embed-english-v3.0',
					inputType: 'search_document',
					embeddingTypes: ['float'],
				});

				const embeddings =
					embedResponse.embeddings && 'float' in embedResponse.embeddings
						? embedResponse.embeddings.float
						: [];

				for (let j = 0; j < batch.length; j += 1) {
					const chunk = batch[j];
					const embedding = embeddings[j] || [];

					await pool.query(
						`INSERT INTO chunks (
							id, doc_id, section, order_index, content, embedding,
							language, version, product, tenant_id, updated_at, metadata
						) VALUES (
							$1, $2, $3, $4, $5, $6,
							$7, $8, $9, $10, NOW(), $11
						)
						ON CONFLICT (id) DO UPDATE SET
							section = EXCLUDED.section,
							order_index = EXCLUDED.order_index,
							content = EXCLUDED.content,
							embedding = EXCLUDED.embedding,
							language = EXCLUDED.language,
							version = EXCLUDED.version,
							product = EXCLUDED.product,
							tenant_id = EXCLUDED.tenant_id,
							updated_at = NOW(),
							metadata = EXCLUDED.metadata`,
						[
							chunk.id,
							chunk.doc_id,
							chunk.section,
							chunk.order_index,
							chunk.content,
							`[${embedding.join(',')}]`,
							chunk.language || null,
							chunk.version || null,
							chunk.product || null,
							chunk.tenant_id || null,
							chunk.metadata || {},
						]
					);
				}
			}
		}

		console.log('Indexing complete.');
	} catch (error: any) {
		console.error('Indexing failed:', error.message);
		process.exit(1);
	} finally {
		await pool.end();
	}
};

main();
