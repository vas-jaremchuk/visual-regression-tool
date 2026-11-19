import { execFileSync } from 'node:child_process';
import { adminClient, ensureUser, setDisabled, setMembership } from './helpers/admin';
import {
  E2E_ADMIN,
  E2E_DISABLED,
  E2E_PROJECT_ADMIN,
  OTHER_PROJECT,
  SEEDED_PROJECT,
} from './fixtures';

export default async function globalSetup() {
  const supabase = adminClient();

  // A project nobody is a member of: only platform admins may see it.
  const { error } = await supabase.from('projects').upsert(
    {
      slug: OTHER_PROJECT.slug,
      name: OTHER_PROJECT.name,
      sitemap_index: 'http://localhost:4010/sitemap_index.xml',
      r2_bucket: 'vrt-e2e-other-site',
    },
    { onConflict: 'slug' },
  );
  if (error) throw error;

  // Exercises `pnpm seed:admin <email>` (REQ-AUTH-2) end to end.
  execFileSync('pnpm', ['seed:admin', E2E_ADMIN], { stdio: 'inherit', env: process.env });

  await setDisabled(await ensureUser(E2E_DISABLED), false);

  // Admin of the seeded project only (members.spec.ts).
  const projectAdmin = await ensureUser(E2E_PROJECT_ADMIN);
  await setDisabled(projectAdmin, false);
  await setMembership(SEEDED_PROJECT.slug, projectAdmin, 'admin');
}
