import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json } from '@vrt/db';
import { itemStatus, type ItemKind, type RunStatus } from '@vrt/shared';
import type { ItemCounts, PendingItem, RunRow, RunStore } from './run-job';

/** `RunStore` over the service-role Supabase client (RLS bypassed; worker only). */

const PAGE = 1000;

function check<T>(what: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Could not ${what}: ${result.error.message}`);
  return result.data;
}

export function supabaseRunStore(db: SupabaseClient): RunStore {
  return {
    async loadRun(runId) {
      const row = check(
        'load the run',
        await db
          .from('runs')
          .select('id, project_id, label, status, started_at, cancel_requested_at, workflow_id')
          .eq('id', runId)
          .maybeSingle(),
      );
      if (!row) return null;
      return {
        id: row.id,
        projectId: row.project_id,
        label: row.label,
        status: row.status as RunStatus,
        startedAt: row.started_at,
        cancelRequestedAt: row.cancel_requested_at,
        workflowId: row.workflow_id,
      } satisfies RunRow;
    },

    async loadBucket(projectId) {
      const row = check(
        'load the project',
        await db.from('projects').select('r2_bucket').eq('id', projectId).maybeSingle(),
      );
      if (!row) throw new Error(`Project ${projectId} not found`);
      return row.r2_bucket as string;
    },

    async updateRun(runId, patch) {
      check('update the run', await db.from('runs').update(patch).eq('id', runId));
    },

    async listPendingItems(runId) {
      const items: PendingItem[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const rows = check(
          'list pending items',
          await db
            .from('run_items')
            .select('id, kind, url, viewport_slug')
            .eq('run_id', runId)
            .eq('status', 'pending')
            .order('kind')
            .order('url')
            .order('id')
            .range(offset, offset + PAGE - 1),
        );
        for (const row of rows ?? []) {
          items.push({
            id: row.id,
            kind: row.kind as ItemKind,
            url: row.url,
            viewportSlug: row.viewport_slug,
          });
        }
        if ((rows ?? []).length < PAGE) return items;
      }
    },

    async countItems(runId) {
      const counts = Object.fromEntries(itemStatus.options.map((s) => [s, 0])) as ItemCounts;
      await Promise.all(
        itemStatus.options.map(async (status) => {
          const { count, error } = await db
            .from('run_items')
            .select('id', { count: 'exact', head: true })
            .eq('run_id', runId)
            .eq('status', status);
          if (error) throw new Error(`Could not count items: ${error.message}`);
          counts[status] = count ?? 0;
        }),
      );
      return counts;
    },

    async setItemStatus(runId, from, to, error) {
      const patch: Record<string, unknown> = { status: to };
      if (error !== undefined) patch.error = error;
      if (to === 'failed' || to === 'skipped') patch.finished_at = new Date().toISOString();
      check(
        'update items',
        await db.from('run_items').update(patch).eq('run_id', runId).in('status', from),
      );
    },

    async refreshCounts(runId) {
      check('refresh run counts', await db.rpc('refresh_run_counts', { p_run_id: runId }));
    },

    async audit(action, projectId, details) {
      check(
        'write the audit log',
        await db
          .from('audit_log')
          .insert({ action, project_id: projectId, actor_id: null, details: details as Json }),
      );
    },
  };
}
