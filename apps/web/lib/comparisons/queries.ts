import 'server-only';
import type { ComparisonStatus, RunStatus } from '@vrt/shared';
import { createClient } from '../supabase/server';
import type { ReviewCounts } from './report';

export { reviewProgress, type ReviewCounts } from './report';

/** Comparisons list (F-CMP-7) and the runs that can be compared (F-CMP-1), as the user sees them. */

export const COMPARISON_LIST_LIMIT = 100;

export interface ComparisonCounts {
  compared: number;
  changed: number;
  unchanged: number;
  new: number;
  missing: number;
  redirect: number;
  error: number;
  files_changed: number;
  files_total: number;
}

export interface ComparisonSummary {
  id: string;
  label: string;
  status: ComparisonStatus;
  beforeRunId: string;
  afterRunId: string;
  beforeLabel: string;
  afterLabel: string;
  counts: Partial<ComparisonCounts>;
  reviewCounts: Partial<ReviewCounts>;
  createdAt: string;
  finishedAt: string | null;
}

export interface ComparableRun {
  id: string;
  label: string;
  status: RunStatus;
  createdAt: string;
}

type Labels = { label: string } | { label: string }[] | null;

function labelOf(value: Labels): string {
  return (Array.isArray(value) ? value[0]?.label : value?.label) ?? '';
}

export async function listComparisons(projectId: string): Promise<ComparisonSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('comparisons')
    .select(
      'id, label, status, counts, review_counts, created_at, finished_at, before_run_id, ' +
        'after_run_id, before:runs!comparisons_project_id_before_run_id_fkey(label), ' +
        'after:runs!comparisons_project_id_after_run_id_fkey(label)',
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(COMPARISON_LIST_LIMIT);
  if (error) throw new Error(`Could not load comparisons: ${error.message}`);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    label: row.label as string,
    status: row.status as ComparisonStatus,
    beforeRunId: row.before_run_id as string,
    afterRunId: row.after_run_id as string,
    beforeLabel: labelOf(row.before as Labels),
    afterLabel: labelOf(row.after as Labels),
    counts: (row.counts ?? {}) as Partial<ComparisonCounts>,
    reviewCounts: (row.review_counts ?? {}) as Partial<ReviewCounts>,
    createdAt: row.created_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
  }));
}

/** Completed runs, newest first, and the project's baseline run id. */
export async function listComparableRuns(
  projectId: string,
): Promise<{ runs: ComparableRun[]; baselineRunId: string | null }> {
  const supabase = await createClient();
  const [runs, project] = await Promise.all([
    supabase
      .from('runs')
      .select('id, label, status, created_at')
      .eq('project_id', projectId)
      .in('status', ['completed', 'completed_with_errors'])
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('projects_public').select('baseline_run_id').eq('id', projectId).maybeSingle(),
  ]);
  if (runs.error) throw new Error(`Could not load runs: ${runs.error.message}`);
  if (project.error) throw new Error(`Could not load the project: ${project.error.message}`);
  return {
    runs: (runs.data ?? []).map((r) => ({
      id: r.id,
      label: r.label,
      status: r.status,
      createdAt: r.created_at,
    })),
    baselineRunId: project.data?.baseline_run_id ?? null,
  };
}
