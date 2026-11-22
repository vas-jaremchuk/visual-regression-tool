import { z } from 'zod';
import { required, url } from './env-fields';

/**
 * The part of `webEnv` the browser bundle may see. Its own module so client code importing it
 * does not pull the server env schemas into the bundle (NFR-13).
 */
export const webPublicEnv = z.object({
  NEXT_PUBLIC_SUPABASE_URL: url('NEXT_PUBLIC_SUPABASE_URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
});
export type WebPublicEnv = z.infer<typeof webPublicEnv>;
