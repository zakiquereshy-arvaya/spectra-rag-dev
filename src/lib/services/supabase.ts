// Supabase client for server-side operations
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

export interface ChatSession {
	id: string;
	messages: any[]; // ChatMessageV2[]
	created_at: string;
	updated_at: string;
}

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
	if (!supabaseClient) {
		const url = env.PUBLIC_SUPABASE_URL;
		const key = env.SUPABASE_SERVICE_ROLE_KEY;
		if (!url || !key) {
			throw new Error('Missing Supabase environment variables');
		}

		supabaseClient = createClient(url, key, {
			auth: {
				autoRefreshToken: false,
				persistSession: false,
			},
		});
	}
	return supabaseClient;
}
