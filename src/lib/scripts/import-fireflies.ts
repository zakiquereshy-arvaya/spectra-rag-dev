import { createFirefliesService } from '$lib/services/fireflies';
import { createVectorDBService } from '$lib/services/vector-db';

type ImportOptions = {
	limit?: number;
	batchSize?: number;
	recent?: number;
	transcriptId?: string;
};

const parseArgs = (argv: string[]): Record<string, string> => {
	const options: Record<string, string> = {};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (!arg.startsWith('--')) continue;

		const [rawKey, rawValue] = arg.slice(2).split('=');
		const key = rawKey.trim();

		if (!key) continue;
		if (rawValue !== undefined) {
			options[key] = rawValue.trim();
			continue;
		}

		const next = argv[i + 1];
		if (next && !next.startsWith('--')) {
			options[key] = next.trim();
			i += 1;
		} else {
			options[key] = 'true';
		}
	}

	return options;
};

const toPositiveNumber = (value: string | undefined, name: string): number | undefined => {
	if (value === undefined) return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`Invalid ${name} value: ${value}`);
	}
	return parsed;
};

const main = async () => {
	const args = parseArgs(process.argv.slice(2));
	const limit = toPositiveNumber(args.limit, 'limit');
	const batchSize = toPositiveNumber(args.batchSize, 'batchSize') ?? 50;
	const recent = toPositiveNumber(args.recent, 'recent');
	const transcriptId = args.transcriptId;

	const databaseUrl = process.env.VECTOR_DATABASE_URL;
	const cohereApiKey = process.env.COHERE_API_KEY;
	const firefliesApiKey = process.env.FF_API_KEY;

	if (!databaseUrl || !cohereApiKey || !firefliesApiKey) {
		console.error('Missing required environment variables:');
		if (!databaseUrl) console.error('  - VECTOR_DATABASE_URL');
		if (!cohereApiKey) console.error('  - COHERE_API_KEY');
		if (!firefliesApiKey) console.error('  - FF_API_KEY');
		process.exit(1);
	}

	const vectorDB = createVectorDBService(databaseUrl, cohereApiKey);
	const fireflies = createFirefliesService({ apiKey: firefliesApiKey });

	try {
		if (transcriptId) {
			const transcript = await fireflies.fetchTranscript(transcriptId);
			await vectorDB.upsertTranscript(transcript);
			console.log(`✓ Imported transcript ${transcript.id}`);
		} else if (recent) {
			const transcripts = await fireflies.fetchRecentTranscripts(recent);
			let imported = 0;

			for (const transcript of transcripts) {
				await vectorDB.upsertTranscript(transcript);
				imported += 1;
			}

			console.log(`✓ Imported ${imported} recent transcripts`);
		} else {
			let imported = 0;

			for await (const transcript of fireflies.fetchAllTranscripts({ batchSize })) {
				await vectorDB.upsertTranscript(transcript);
				imported += 1;

				if (limit && imported >= limit) {
					break;
				}
			}

			console.log(`✓ Imported ${imported} transcripts`);
		}

		await vectorDB.close();
		process.exit(0);
	} catch (error: any) {
		console.error('✗ Import failed:', error.message);
		await vectorDB.close();
		process.exit(1);
	}
};

main();
