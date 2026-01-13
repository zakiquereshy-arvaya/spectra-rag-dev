// Supabase Client Service
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

// Database types for chat sessions
export interface ChatSessionRow {
	id: string;
	messages: string; // JSON string of ChatMessageV2[]
	created_at: string;
	updated_at: string;
}

let supabaseClient: SupabaseClient | null = null;

/**
 * Get or create Supabase client singleton
 * Uses service role key for server-side operations
 */
export function getSupabaseClient(): SupabaseClient {
	if (supabaseClient) {
		return supabaseClient;
	}

	const supabaseUrl = env.SUPABASE_URL;
	const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

	if (!supabaseUrl || !supabaseKey) {
		throw new Error('Supabase environment variables not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
	}

	supabaseClient = createClient(supabaseUrl, supabaseKey, {
		auth: {
			autoRefreshToken: false,
			persistSession: false,
		},
	});

	return supabaseClient;
}

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(): boolean {
	return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}
