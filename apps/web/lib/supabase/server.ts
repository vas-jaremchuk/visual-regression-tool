import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@vrt/db';
import { cookies } from 'next/headers';
import { publicEnv } from '../public-env';

/** Supabase client acting as the signed-in user (RLS applies). One per request. */
export async function createClient() {
  const cookieStore = await cookies();
  const env = publicEnv();
  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, which cannot set cookies; proxy.ts refreshes them.
          }
        },
      },
    },
  );
}
