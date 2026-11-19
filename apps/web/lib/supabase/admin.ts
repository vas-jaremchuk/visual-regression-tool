import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@vrt/db';
import { serverEnv } from '../env';

/** Service-role client: bypasses RLS. Server only, never pass its results to the client unfiltered. */
export function createAdminClient() {
  const env = serverEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
