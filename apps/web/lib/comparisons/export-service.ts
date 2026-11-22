import 'server-only';
import type { ReportItem as StaticReportItem } from '@vrt/engine';
import { assertCan } from '../auth/assert-can';
import type { CurrentUser } from '../auth/session';
import { r2Store } from '../r2/service';
import { createClient } from '../supabase/server';
import { exportComparisonHtml, type ExportGateway } from './export';

type Labels = { label: string } | { label: string }[] | null;

function labelOf(value: Labels): string {
  return (Array.isArray(value) ? value[0]?.label : value?.label) ?? '';
}

/** PostgREST answers at most this many rows per request. */
const ITEM_BATCH = 1000;

const ITEM_COLUMNS =
  'url, name, kind, viewport_slug, status, diff_pct, diff_pixels, total_pixels, ' +
  'before_key, after_key, diff_key, redirect_to, fp_before, fp_after, review, error';

/** The static HTML report of a comparison, as the signed-in user may see it (RLS). */
export async function exportComparison(
  user: CurrentUser,
  comparisonId: string,
): Promise<{ filename: string; html: string }> {
  const supabase = await createClient();
  const store = r2Store();
  const gateway: ExportGateway = {
    async loadComparison(id) {
      const { data, error } = await supabase
        .from('comparisons')
        .select(
          'id, project_id, label, settings, ' +
            'before:runs!comparisons_project_id_before_run_id_fkey(label), ' +
            'after:runs!comparisons_project_id_after_run_id_fkey(label)',
        )
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`Could not load the comparison: ${error.message}`);
      if (!data) return null;
      const row = data as unknown as Record<string, unknown>;
      const project = await supabase
        .from('projects_public')
        .select('name, r2_bucket, r2_public_url, change_threshold_pct')
        .eq('id', row.project_id as string)
        .maybeSingle();
      if (project.error) throw new Error(`Could not load the project: ${project.error.message}`);
      if (!project.data) return null;
      const settings = (row.settings ?? {}) as Record<string, unknown>;
      return {
        id: row.id as string,
        projectId: row.project_id as string,
        projectName: project.data.name,
        label: row.label as string,
        beforeLabel: labelOf(row.before as Labels),
        afterLabel: labelOf(row.after as Labels),
        changeThresholdPct:
          typeof settings.changeThresholdPct === 'number'
            ? settings.changeThresholdPct
            : Number(project.data.change_threshold_pct),
        publicUrl: project.data.r2_public_url,
        bucket: project.data.r2_bucket,
      };
    },
    async assertCan(action, projectId) {
      await assertCan(user, action, projectId);
    },
    async listItems(id) {
      const items: StaticReportItem[] = [];
      for (let from = 0; ; from += ITEM_BATCH) {
        const { data, error } = await supabase
          .from('comparison_items')
          .select(ITEM_COLUMNS)
          .eq('comparison_id', id)
          .order('id')
          .range(from, from + ITEM_BATCH - 1);
        if (error) throw new Error(`Could not load the items: ${error.message}`);
        const rows = (data ?? []) as unknown as StaticReportItem[];
        items.push(
          ...rows.map((r) => ({ ...r, diff_pct: r.diff_pct == null ? null : Number(r.diff_pct) })),
        );
        if (rows.length < ITEM_BATCH) return items;
      }
    },
    presignGet: (bucket, key, expiresInSeconds) => store.presignGet(bucket, key, expiresInSeconds),
  };
  return exportComparisonHtml(gateway, comparisonId);
}
