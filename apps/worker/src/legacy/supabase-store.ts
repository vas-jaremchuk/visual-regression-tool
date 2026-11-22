import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImportStore } from './import-job';

/** `ImportStore` over the service-role Supabase client (RLS bypassed; worker only). */

const PAGE = 1000;
const INSERT_CHUNK = 500;

function check<T>(what: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Could not ${what}: ${result.error.message}`);
  return result.data;
}

export function supabaseImportStore(db: SupabaseClient): ImportStore {
  return {
    async loadProject(projectId) {
      const row = check(
        'load the project',
        await db
          .from('projects')
          .select('id, r2_bucket, file_extensions')
          .eq('id', projectId)
          .maybeSingle(),
      ) as { id: string; r2_bucket: string; file_extensions: string[] | null } | null;
      if (!row) return null;
      return { id: row.id, r2Bucket: row.r2_bucket, fileExtensions: row.file_extensions };
    },

    async findRun(projectId, label) {
      const row = check(
        'load the run',
        await db
          .from('runs')
          .select('id, is_legacy, status')
          .eq('project_id', projectId)
          .eq('label', label)
          .maybeSingle(),
      ) as { id: string; is_legacy: boolean; status: string } | null;
      return row ? { id: row.id, isLegacy: row.is_legacy, status: row.status } : null;
    },

    async latestSnapshotUrls(projectId) {
      const snapshots = check(
        'load the latest snapshot',
        await db
          .from('sitemap_snapshots')
          .select('id')
          .eq('project_id', projectId)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1),
      ) as { id: string }[] | null;
      const snapshotId = snapshots?.[0]?.id;
      if (!snapshotId) return [];
      const urls: { url: string; kind: 'page' | 'file'; included: boolean }[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const rows = (check(
          'load snapshot URLs',
          await db
            .from('sitemap_urls')
            .select('url, kind, included')
            .eq('snapshot_id', snapshotId)
            .order('url')
            .range(offset, offset + PAGE - 1),
        ) ?? []) as typeof urls;
        urls.push(...rows);
        if (rows.length < PAGE) return urls;
      }
    },

    async createRun(run) {
      return check(
        'create the run',
        await db
          .from('runs')
          .insert({
            project_id: run.projectId,
            label: run.label,
            status: 'running',
            is_legacy: true,
            snapshot_id: null,
            note: 'Imported prototype run',
            started_at: run.startedAt,
          })
          .select('id')
          .single(),
      ) as { id: string };
    },

    async deleteItems(runId) {
      check('delete run items', await db.from('run_items').delete().eq('run_id', runId));
    },

    async insertItems(runId, items, finishedAt) {
      for (let i = 0; i < items.length; i += INSERT_CHUNK) {
        check(
          'create run items',
          await db.from('run_items').insert(
            items.slice(i, i + INSERT_CHUNK).map((item) => ({
              ...item,
              run_id: runId,
              status: 'done',
              finished_at: finishedAt,
            })),
          ),
        );
      }
    },

    async updateRun(runId, patch) {
      check('update the run', await db.from('runs').update(patch).eq('id', runId));
    },

    async refreshCounts(runId) {
      check('refresh run counts', await db.rpc('refresh_run_counts', { p_run_id: runId }));
    },
  };
}
