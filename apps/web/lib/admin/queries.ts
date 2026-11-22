import 'server-only';
import type { Json } from '@vrt/db';
import { serverEnv } from '../env';
import { listProjects } from '../projects';
import { createClient } from '../supabase/server';
import { actionPattern, AUDIT_PAGE_SIZE, dateRange, type AuditFilters } from './audit-filters';
import { fetchDlqCounts, type DlqCount } from './dlq';
import { assessActiveJobs, type ActiveJob, type ActiveJobInput } from './job-health';

/** Read side of the admin audit log and job health pages (F-ADMIN-2/3), as the signed-in user. */

export interface AuditEntry {
  id: string;
  action: string;
  details: Json;
  createdAt: string;
  actor: string | null;
  projectId: string | null;
}

export interface ActorOption {
  id: string;
  label: string;
}

function personName(profile: { email: string; full_name: string | null } | null) {
  return profile ? (profile.full_name ?? profile.email) : null;
}

/**
 * One page of the audit log, newest first. RLS limits rows to platform admins and to project
 * admins for their projects (02 §4). Fetches one extra row to know whether a next page exists.
 */
export async function listAuditLog(
  filters: AuditFilters,
): Promise<{ entries: AuditEntry[]; hasMore: boolean }> {
  const supabase = await createClient();
  const offset = (filters.page - 1) * AUDIT_PAGE_SIZE;
  let query = supabase
    .from('audit_log')
    .select('id, action, details, created_at, project_id, profiles(email, full_name)')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + AUDIT_PAGE_SIZE);
  if (filters.project) query = query.eq('project_id', filters.project);
  if (filters.actor) query = query.eq('actor_id', filters.actor);
  if (filters.action) query = query.like('action', actionPattern(filters.action));
  const { gte, lt } = dateRange(filters);
  if (gte) query = query.gte('created_at', gte);
  if (lt) query = query.lt('created_at', lt);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load the audit log: ${error.message}`);
  const entries = data.slice(0, AUDIT_PAGE_SIZE).map((row) => ({
    id: row.id,
    action: row.action,
    details: row.details,
    createdAt: row.created_at,
    actor: personName(row.profiles),
    projectId: row.project_id,
  }));
  return { entries, hasMore: data.length > AUDIT_PAGE_SIZE };
}

/** People the user can see, for the actor filter. */
export async function listActorOptions(): Promise<ActorOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .order('email');
  if (error) throw new Error(`Could not load users: ${error.message}`);
  return data.map((row) => ({ id: row.id, label: personName(row)! }));
}

export interface RecentFailure {
  kind: 'run' | 'comparison';
  id: string;
  label: string;
  status: string;
  projectName: string;
  projectSlug: string;
  finishedAt: string | null;
}

export interface ItemError {
  runLabel: string;
  projectName: string;
  projectSlug: string;
  /** URL, or the filename for legacy items without one. */
  url: string;
  error: string;
  finishedAt: string | null;
}

export interface JobHealth {
  active: ActiveJob[];
  failures: RecentFailure[];
  errors: ItemError[];
}

const RECENT = 20;

/** Active runs/comparisons across projects with their stuck flag, recent failures, last errors. */
export async function getJobHealth(now = new Date()): Promise<JobHealth> {
  const supabase = await createClient();
  const [{ projects }, runs, comparisons, failedRuns, failedComparisons, itemErrors] =
    await Promise.all([
      listProjects(),
      supabase
        .from('runs')
        .select(
          'id, label, status, project_id, total_items, done_items, failed_items, created_at, started_at',
        )
        .in('status', ['queued', 'running'])
        .order('created_at'),
      supabase
        .from('comparisons')
        .select('id, label, status, project_id, created_at, started_at')
        .in('status', ['queued', 'running'])
        .order('created_at'),
      supabase
        .from('runs')
        .select('id, label, status, project_id, finished_at')
        .in('status', ['failed', 'completed_with_errors', 'delete_failed'])
        .order('finished_at', { ascending: false, nullsFirst: false })
        .limit(RECENT),
      supabase
        .from('comparisons')
        .select('id, label, status, project_id, finished_at')
        .in('status', ['failed', 'delete_failed'])
        .order('finished_at', { ascending: false, nullsFirst: false })
        .limit(RECENT),
      supabase
        .from('run_items')
        .select('url, filename, error, finished_at, runs(label, project_id)')
        .eq('status', 'failed')
        .not('error', 'is', null)
        .order('finished_at', { ascending: false, nullsFirst: false })
        .limit(RECENT),
    ]);
  for (const result of [runs, comparisons, failedRuns, failedComparisons, itemErrors]) {
    if (result.error) throw new Error(`Could not load job health: ${result.error.message}`);
  }
  const byId = new Map(projects.map((p) => [p.id, p]));
  const project = (id: string) => ({
    projectName: byId.get(id)?.name ?? 'Unknown project',
    projectSlug: byId.get(id)?.slug ?? '',
  });

  // Newest finished item per active run: the run's last sign of progress.
  const lastItemAt = new Map<string, string | null>(
    await Promise.all(
      (runs.data ?? []).map(async (run): Promise<[string, string | null]> => {
        const { data, error } = await supabase
          .from('run_items')
          .select('finished_at')
          .eq('run_id', run.id)
          .not('finished_at', 'is', null)
          .order('finished_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(`Could not load job health: ${error.message}`);
        return [run.id, data?.finished_at ?? null];
      }),
    ),
  );

  const active: ActiveJobInput[] = [
    ...(runs.data ?? []).map((run) => ({
      kind: 'run' as const,
      id: run.id,
      label: run.label,
      status: run.status,
      ...project(run.project_id),
      totalItems: run.total_items,
      doneItems: run.done_items,
      failedItems: run.failed_items,
      createdAt: run.created_at,
      startedAt: run.started_at,
      lastItemAt: lastItemAt.get(run.id) ?? null,
    })),
    ...(comparisons.data ?? []).map((cmp) => ({
      kind: 'comparison' as const,
      id: cmp.id,
      label: cmp.label,
      status: cmp.status,
      ...project(cmp.project_id),
      totalItems: null,
      doneItems: null,
      failedItems: null,
      createdAt: cmp.created_at,
      startedAt: cmp.started_at,
      lastItemAt: null,
    })),
  ];

  const failures: RecentFailure[] = [
    ...(failedRuns.data ?? []).map((run) => ({ kind: 'run' as const, ...run })),
    ...(failedComparisons.data ?? []).map((cmp) => ({ kind: 'comparison' as const, ...cmp })),
  ]
    .map(({ kind, id, label, status, project_id, finished_at }) => ({
      kind,
      id,
      label,
      status,
      ...project(project_id),
      finishedAt: finished_at,
    }))
    .sort((a, b) => Date.parse(b.finishedAt ?? '0') - Date.parse(a.finishedAt ?? '0'))
    .slice(0, RECENT);

  const errors: ItemError[] = (itemErrors.data ?? []).map((item) => ({
    runLabel: item.runs?.label ?? '',
    ...project(item.runs?.project_id ?? ''),
    url: item.url ?? item.filename,
    error: item.error ?? '',
    finishedAt: item.finished_at,
  }));

  return { active: assessActiveJobs(active, now), failures, errors };
}

/** DLQ message counts (06 §8) with the platform Cloudflare credentials. */
export async function getDlqCounts(): Promise<DlqCount[]> {
  const env = serverEnv();
  return fetchDlqCounts({ accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN, fetch });
}
