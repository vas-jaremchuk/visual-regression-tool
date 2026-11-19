import { parseEnv, webPublicEnv, type WebPublicEnv } from '@vrt/shared';

/**
 * Browser-safe env. Each variable is referenced literally so Next.js inlines it into the
 * client bundle; nothing outside `webPublicEnv` may be read here.
 */
export function publicEnv(): WebPublicEnv {
  return parseEnv(
    webPublicEnv,
    {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
    'web (public)',
  );
}
