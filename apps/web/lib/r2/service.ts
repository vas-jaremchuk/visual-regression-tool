import 'server-only';
import { R2ObjectStore } from '@vrt/storage';
import { assertCan } from '../auth/assert-can';
import type { CurrentUser } from '../auth/session';
import { serverEnv } from '../env';
import { createClient } from '../supabase/server';
import { signComparisonObject, type SignGateway } from './sign';

type Labels = { label: string } | { label: string }[] | null;

function labelOf(value: Labels): string {
  return (Array.isArray(value) ? value[0]?.label : value?.label) ?? '';
}

/** Signs `key` of comparison `comparisonId` as the signed-in user (RLS decides visibility). */
export async function signObject(
  user: CurrentUser,
  input: { comparisonId: string; key: string },
): Promise<{ url: string; expiresAt: string }> {
  const supabase = await createClient();
  const env = serverEnv();
  const store = new R2ObjectStore({
    accountId: env.CF_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });
  const gateway: SignGateway = {
    async loadComparison(comparisonId) {
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
      const project = await supabase
        .from('projects_public')
        .select('r2_bucket')
        .eq('id', row.project_id as string)
        .maybeSingle();
      if (project.error) throw new Error(`Could not load the project: ${project.error.message}`);
      if (!project.data?.r2_bucket) return null;
      return {
        id: row.id as string,
        projectId: row.project_id as string,
        label: row.label as string,
        beforeLabel: labelOf(row.before as Labels),
        afterLabel: labelOf(row.after as Labels),
        bucket: project.data.r2_bucket,
      };
    },
    async assertCan(action, projectId) {
      await assertCan(user, action, projectId);
    },
    presignGet: (bucket, key, expiresInSeconds) => store.presignGet(bucket, key, expiresInSeconds),
  };
  return signComparisonObject(gateway, input);
}
