import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@vrt/db';
import { publicEnv } from '../public-env';

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

/** Browser Supabase client (anon key + session cookies), e.g. for Realtime subscriptions. */
export function createClient() {
  const env = publicEnv();
  client ??= createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return client;
}
