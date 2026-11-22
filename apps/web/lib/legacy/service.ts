import 'server-only';
import { R2ObjectStore } from '@vrt/storage';
import { audit } from '../audit';
import { assertCan, ForbiddenError } from '../auth/assert-can';
import type { CurrentUser } from '../auth/session';
import { serverEnv } from '../env';
import { createClient } from '../supabase/server';
import { workerClient } from '../worker-client';
import { createLegacyCommands } from './commands';

async function commands(user: CurrentUser | null) {
  if (!user) throw new ForbiddenError('legacy.import');
  const supabase = await createClient();
  const env = serverEnv();
  const store = new R2ObjectStore({
    accountId: env.CF_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });
  return createLegacyCommands({
    authorize: async (projectId) => {
      await assertCan(user, 'legacy.import', projectId);
    },
    db: {
      async loadProject(projectId) {
        const { data, error } = await supabase
          .from('projects_public')
          .select('id, r2_bucket, archived_at')
          .eq('id', projectId)
          .maybeSingle();
        if (error) throw new Error(`Could not load the project: ${error.message}`);
        if (!data?.id || !data.r2_bucket) return null;
        return { id: data.id, r2Bucket: data.r2_bucket, archived: data.archived_at !== null };
      },
      async runLabels(projectId) {
        const { data, error } = await supabase
          .from('runs')
          .select('label')
          .eq('project_id', projectId);
        if (error) throw new Error(`Could not load run labels: ${error.message}`);
        return (data ?? []).map((r) => r.label);
      },
      async listPrefixes(bucket, prefix) {
        const prefixes: string[] = [];
        for await (const p of store.listPrefixes(bucket, prefix)) prefixes.push(p);
        return prefixes;
      },
      startImport: (projectId, labels) => workerClient().startImportLegacy({ projectId, labels }),
      audit: (action, projectId, details) => audit(supabase, action, projectId, details),
    },
  });
}

/** F-RUN-6: project admin lists the bucket's prototype runs that are not imported yet. */
export async function listLegacyLabels(
  user: CurrentUser | null,
  projectId: string,
): Promise<{ labels: string[] }> {
  return (await commands(user)).listLabels(projectId);
}

/** F-RUN-6: project admin imports the selected prototype runs as `is_legacy` runs. */
export async function importLegacyLabels(
  user: CurrentUser | null,
  projectId: string,
  labels: string[],
): Promise<{ workflowId: string }> {
  return (await commands(user)).importLabels(projectId, labels);
}
