import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { WorkerEnv } from '@vrt/shared';

/**
 * Supabase client authenticated with the service role key (04 §6). Bypasses RLS, so it is only
 * used inside the worker; the key never leaves Cloudflare. No session is persisted: Workers have
 * no storage between requests and the client acts as the service, not a user.
 */
export function createServiceClient(
  config: Pick<WorkerEnv, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>,
): SupabaseClient {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
