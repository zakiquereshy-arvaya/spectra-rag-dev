import { Pinecone } from '@pinecone-database/pinecone';
import { PINECONE_API_KEY, PINECONE_INDEX_NAME } from '$env/static/private';

export const pinecone = new Pinecone({
    apiKey: PINECONE_API_KEY,
});

/**
 * Get the Pinecone index instance
 */
export function getPineconeIndex(indexName?: string) {
    const name = indexName || PINECONE_INDEX_NAME || 'taleo-doc';
    return pinecone.index(name);
}

/**
 * Query Pinecone index with a vector
 */
export async function queryPinecone(
    vector: number[],
    topK: number = 5,
    indexName?: string
): Promise<Array<{ content: string; metadata?: Record<string, any>; score: number }>> {
    try {
        const index = getPineconeIndex(indexName);
        
        const results = await index.query({
            vector: vector,
            topK: topK,
            includeMetadata: true,
        });

        return results.matches.map(match => ({
            content: (match.metadata?.text || match.metadata?.content || '') as string,
            metadata: match.metadata as Record<string, any> | undefined,
            score: match.score || 0,
        }));
    } catch (error: any) {
        console.error('Pinecone query error:', error);
        throw new Error(`Pinecone query error: ${error.message || 'Unknown error'}`);
    }
}