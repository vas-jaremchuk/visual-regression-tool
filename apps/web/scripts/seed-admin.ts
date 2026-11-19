/**
 * `pnpm seed:admin <email>`: creates (or promotes) the first platform admin with the service
 * role key (REQ-AUTH-2). Re-running is safe; a disabled user is re-enabled.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@vrt/db';
import { parseEnv, webEnv } from '@vrt/shared';
import { z } from 'zod';

const env = parseEnv(
  webEnv.pick({ NEXT_PUBLIC_SUPABASE_URL: true, SUPABASE_SERVICE_ROLE_KEY: true }),
  process.env,
  'seed:admin',
);
const parsed = z.email().trim().toLowerCase().safeParse(process.argv[2]);
if (!parsed.success) {
  console.error('Usage: pnpm seed:admin <email>');
  process.exit(1);
}
const email = parsed.data;

const supabase = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

async function run() {
  const { data: existing, error: lookupError } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (lookupError) throw lookupError;

  let userId = existing?.id;
  if (!userId) {
    const { data, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    userId = data.user.id;
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ is_platform_admin: true, disabled_at: null })
    .eq('id', userId);
  if (updateError) throw updateError;

  const { error: auditError } = await supabase.from('audit_log').insert({
    actor_id: null,
    action: 'user.promote_admin',
    details: { email, source: 'seed:admin', created: !existing },
  });
  if (auditError) throw auditError;

  console.log(`${existing ? 'Promoted' : 'Created'} platform admin ${email}`);
}

run().catch((error: unknown) => {
  const message =
    error && typeof error === 'object' && 'message' in error ? error.message : String(error);
  console.error(`seed:admin failed: ${String(message)}`);
  process.exit(1);
});
