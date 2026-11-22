import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@vrt/db';
import { isShareTokenShape } from './token';

/**
 * `resolve_share_token` (09 §2): the comparison id of a live token, else null. Revoked links have
 * no hash and expired ones are filtered by the RPC, so both resolve to null (→ 404).
 */
export async function resolveShareToken(
  supabase: SupabaseClient<Database>,
  token: string,
): Promise<string | null> {
  if (!isShareTokenShape(token)) return null;
  const { data, error } = await supabase.rpc('resolve_share_token', { p_token: token });
  if (error) throw new Error(`Could not resolve the share link: ${error.message}`);
  return data ?? null;
}
