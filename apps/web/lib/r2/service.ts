import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@vrt/db';
import { R2ObjectStore } from '@vrt/storage';
import { assertCan } from '../auth/assert-can';
import type { CurrentUser } from '../auth/session';
import { serverEnv } from '../env';
import { createAdminClient } from '../supabase/admin';
import { createClient } from '../supabase/server';
import { resolveShareToken } from '../share/resolve';
import {
  signComparisonObject,
  signSharedObject,
  type SharedSignGateway,
  type SignComparison,
  type SignGateway,
} from './sign';

type Labels = { label: string } | { label: string }[] | null;

function labelOf(value: Labels): string {
  return (Array.isArray(value) ? value[0]?.label : value?.label) ?? '';
}

/** The R2 S3 API client with the platform credentials (03 §2). */
export function r2Store(): R2ObjectStore {
  const env = serverEnv();
  return new R2ObjectStore({
    accountId: env.CF_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });
}

/**
 * The comparison with its run labels and bucket, as `supabase` may see it. The service role reads
 * `projects` (the `projects_public` view only shows projects of the signed-in user).
 */
async function loadSignComparison(
  supabase: SupabaseClient<Database>,
  comparisonId: string,
  projectSource: 'projects' | 'projects_public' = 'projects_public',
): Promise<SignComparison | null> {
  const { data, error } = await supabase
    .from('comparisons')
    .select(
      'id, project_id, label, ' +
        'before:runs!comparisons_project_id_before_run_id_fkey(label), ' +
        'after:runs!comparisons_project_id_after_run_id_fkey(label)',
    )
    .eq('id', comparisonId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the comparison: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  const projectId = row.project_id as string;
  const project =
    projectSource === 'projects'
      ? await supabase.from('projects').select('r2_bucket').eq('id', projectId).maybeSingle()
      : await supabase
          .from('projects_public')
          .select('r2_bucket')
          .eq('id', projectId)
          .maybeSingle();
  if (project.error) throw new Error(`Could not load the project: ${project.error.message}`);
  if (!project.data?.r2_bucket) return null;
  return {
    id: row.id as string,
    projectId,
    label: row.label as string,
    beforeLabel: labelOf(row.before as Labels),
    afterLabel: labelOf(row.after as Labels),
    bucket: project.data.r2_bucket,
  };
}

/** Signs `key` of comparison `comparisonId` as the signed-in user (RLS decides visibility). */
export async function signObject(
  user: CurrentUser,
  input: { comparisonId: string; key: string },
): Promise<{ url: string; expiresAt: string }> {
  const supabase = await createClient();
  const store = r2Store();
  const gateway: SignGateway = {
    loadComparison: (comparisonId) => loadSignComparison(supabase, comparisonId),
    async assertCan(action, projectId) {
      await assertCan(user, action, projectId);
    },
    presignGet: (bucket, key, expiresInSeconds) => store.presignGet(bucket, key, expiresInSeconds),
  };
  return signComparisonObject(gateway, input);
}

/**
 * Signs `key` for a share viewer (04 §5). The service role is used only after the token resolved,
 * and only for the comparison it resolved to (ADR-6).
 */
export async function signSharedKey(input: {
  token: string;
  comparisonId?: string;
  key: string;
}): Promise<{ url: string; expiresAt: string }> {
  const admin = createAdminClient();
  const store = r2Store();
  const gateway: SharedSignGateway = {
    resolveShareToken: (token) => resolveShareToken(admin, token),
    loadComparison: (comparisonId) => loadSignComparison(admin, comparisonId, 'projects'),
    presignGet: (bucket, key, expiresInSeconds) => store.presignGet(bucket, key, expiresInSeconds),
  };
  return signSharedObject(gateway, input);
}
