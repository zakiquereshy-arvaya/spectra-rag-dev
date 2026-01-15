// Supabase client for server-side operations
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
export interface ChatSession {
	id: string;
	messages: any[]; // ChatMessageV2[]
	created_at: string;
	updated_at: string;
}

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
	if (!supabaseClient) {
		if (!PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
			throw new Error('Missing Supabase environment variables');
		}

		supabaseClient = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
			auth: {
				autoRefreshToken: false,
				persistSession: false,
			},
		});
	}
	return supabaseClient;
}
