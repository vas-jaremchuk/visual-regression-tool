import { createClient } from '@supabase/supabase-js';
import type { Database } from '@vrt/db';

/** Service-role client for test setup only (local Supabase). */
export function adminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function ensureUser(email: string): Promise<string> {
  const supabase = adminClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (profile) return profile.id;
  const { data, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  return data.user.id;
}

export async function setDisabled(userId: string, disabled: boolean) {
  const { error } = await adminClient()
    .from('profiles')
    .update({ disabled_at: disabled ? new Date().toISOString() : null })
    .eq('id', userId);
  if (error) throw error;
}

export async function deleteUserByEmail(email: string) {
  const supabase = adminClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (profile) await supabase.auth.admin.deleteUser(profile.id);
  await supabase.from('invitations').delete().eq('email', email);
}

export async function setMembership(
  projectSlug: string,
  userId: string,
  role: 'admin' | 'editor' | 'viewer',
) {
  const supabase = adminClient();
  const { data: project, error } = await supabase
    .from('projects')
    .select('id')
    .eq('slug', projectSlug)
    .single();
  if (error) throw error;
  const { error: upsertError } = await supabase
    .from('project_members')
    .upsert({ project_id: project.id, user_id: userId, role });
  if (upsertError) throw upsertError;
  return project.id;
}

/** Audit entries written since `since` (default: the start of the current test file). */
let auditSince = new Date(0).toISOString();

/** Only count audit entries written from now on. */
export function resetAuditWindow() {
  auditSince = new Date().toISOString();
}

export async function auditEntries(
  action: string,
  details: Record<string, unknown>,
  since: string = auditSince,
) {
  const { data, error } = await adminClient()
    .from('audit_log')
    .select('actor_id, project_id, details')
    .eq('action', action)
    .contains('details', details)
    .gte('created_at', since);
  if (error) throw error;
  return data;
}
