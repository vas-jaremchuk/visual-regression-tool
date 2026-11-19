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
