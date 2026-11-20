import 'server-only';
import type { Json } from '@vrt/db';
import type { createClient } from './supabase/server';

type UserClient = Awaited<ReturnType<typeof createClient>>;

/** Audit entry as the signed-in user (02 §2 audit_log). */
export async function audit(
  supabase: UserClient,
  action: string,
  projectId: string | null,
  details: Record<string, Json>,
) {
  const { error } = await supabase.rpc('write_audit_log', {
    p_action: action,
    p_details: details,
    ...(projectId ? { p_project_id: projectId } : {}),
  });
  if (error) throw new Error(`Could not write the audit log: ${error.message}`);
}
