import 'server-only';
import type { Json } from '@vrt/db';
import type { ItemKind, ItemStatus, RunStatus } from '@vrt/shared';
import { R2ObjectStore } from '@vrt/storage';
import { serverEnv } from '../env';
import { publicObjectUrl } from '../projects/bucket-check';
import { createClient } from '../supabase/server';
import { groupFailures, type FailureGroup, type ItemStat } from './progress';

/** Read side of the runs UI (F-RUN-3, 08 §3), as the signed-in user (RLS). */

export interface RunSummary {
  id: string;
  label: string;
  status: RunStatus;
  note: string | null;
  viewportSlugs: string[];
  isLegacy: boolean;
  totalItems: number;
  doneItems: number;
  failedItems: number;
  startedBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequestedAt: string | null;
  createdAt: string;
}

export interface RunDetail extends RunSummary {
  snapshotId: string | null;
  settings: Json;
}

const RUN_SELECT =
  'id, label, status, note, viewport_slugs, is_legacy, total_items, done_items, failed_items, ' +
  'started_at, finished_at, cancel_requested_at, created_at, profiles(email, full_name)';

type RunRow = {
  id: string;
  label: string;
  status: RunStatus;
  note: string | null;
  viewport_slugs: string[];
  is_legacy: boolean;
  total_items: number;
  done_items: number;
  failed_items: number;
  started_at: string | null;
  finished_at: string | null;
  cancel_requested_at: string | null;
  created_at: string;
  profiles: { email: string; full_name: string | null } | null;
  snapshot_id?: string | null;
  settings?: Json;
};

function toSummary(row: RunRow): RunSummary {
  return {
    id: row.id,
    label: row.label,
    status: row.status,
    note: row.note,
    viewportSlugs: row.viewport_slugs,
    isLegacy: row.is_legacy,
    totalItems: row.total_items,
    doneItems: row.done_items,
    failedItems: row.failed_items,
    startedBy: row.profiles ? (row.profiles.full_name ?? row.profiles.email) : null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    cancelRequestedAt: row.cancel_requested_at,
    createdAt: row.created_at,
  };
}

/** Runs of a project, newest first. */
export async function listRuns(projectId: string, limit = 100): Promise<RunSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('runs')
    .select(RUN_SELECT)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load runs: ${error.message}`);
  return (data as unknown as RunRow[]).map(toSummary);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A run by label (08 §1 route) or by id (the 409 link of F-RUN-5). */
export async function getRun(projectId: string, labelOrId: string): Promise<RunDetail | null> {
  const supabase = await createClient();
  const query = supabase
    .from('runs')
    .select(`${RUN_SELECT}, snapshot_id, settings`)
    .eq('project_id', projectId);
  const { data, error } = await (
    UUID.test(labelOrId) ? query.eq('id', labelOrId) : query.eq('label', labelOrId)
  ).maybeSingle();
  if (error) throw new Error(`Could not load the run: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as RunRow;
  return { ...toSummary(row), snapshotId: row.snapshot_id ?? null, settings: row.settings ?? {} };
}

/** Item counts and bytes per run, viewport and status (RPC `run_item_stats`). */
export async function runItemStats(runIds: string[]): Promise<Map<string, ItemStat[]>> {
  const stats = new Map<string, ItemStat[]>();
  if (runIds.length === 0) return stats;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('run_item_stats', { p_run_ids: runIds });
  if (error) throw new Error(`Could not load run statistics: ${error.message}`);
  for (const row of data) {
    const list = stats.get(row.run_id) ?? [];
    list.push({
      viewportSlug: row.viewport_slug,
      status: row.status,
      items: row.items,
      bytes: Number(row.bytes),
    });
    stats.set(row.run_id, list);
  }
  return stats;
}

export const ITEM_PAGE_SIZE = 100;
export const ITEM_STATUSES: readonly ItemStatus[] = [
  'pending',
  'processing',
  'done',
  'failed',
  'skipped',
];

export interface ItemQuery {
  status: ItemStatus | null;
  viewport: string | null;
  search: string;
  page: number;
}

export function parseItemQuery(params: Record<string, string | string[] | undefined>): ItemQuery {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
  };
  const status = one('status') as ItemStatus;
  const page = Number.parseInt(one('page'), 10);
  return {
    status: ITEM_STATUSES.includes(status) ? status : null,
    viewport: one('viewport') || null,
    search: one('q').slice(0, 200),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export interface RunItemRow {
  id: string;
  url: string;
  kind: ItemKind;
  viewportSlug: string | null;
  status: ItemStatus;
  width: number | null;
  height: number | null;
  truncated: boolean;
  error: string | null;
  /** Full screenshot URL (public bucket URL or signed GET), null without a screenshot. */
  imageUrl: string | null;
}

/** Builds image URLs (09 §1): `${r2_public_url}/${key}` when set, else a signed URL (1 h). */
export async function imageUrlBuilder(project: {
  r2Bucket: string;
  r2PublicUrl: string | null;
}): Promise<(key: string) => Promise<string>> {
  if (project.r2PublicUrl) {
    const base = project.r2PublicUrl;
    return async (key) => publicObjectUrl(base, key);
  }
  const env = serverEnv();
  const store = new R2ObjectStore({
    accountId: env.CF_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });
  return (key) => store.presignGet(project.r2Bucket, key);
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** One page of the run's items, filtered (F-RUN-3), with screenshot URLs. */
export async function getItemPage(
  runId: string,
  query: ItemQuery,
  imageUrl: (key: string) => Promise<string>,
): Promise<{ rows: RunItemRow[]; total: number }> {
  const supabase = await createClient();
  let request = supabase
    .from('run_items')
    .select(
      'id, url, filename, kind, viewport_slug, status, width, height, truncated, error, r2_key',
      {
        count: 'exact',
      },
    )
    .eq('run_id', runId);
  if (query.status) request = request.eq('status', query.status);
  if (query.viewport === '_files') request = request.is('viewport_slug', null);
  else if (query.viewport) request = request.eq('viewport_slug', query.viewport);
  if (query.search) request = request.ilike('url', `%${escapeLike(query.search)}%`);
  const from = (query.page - 1) * ITEM_PAGE_SIZE;
  const { data, error, count } = await request
    .order('url')
    .order('viewport_slug', { nullsFirst: false })
    .range(from, from + ITEM_PAGE_SIZE - 1);
  if (error) throw new Error(`Could not load run items: ${error.message}`);
  const rows = await Promise.all(
    data.map(async (row) => ({
      id: row.id,
      // Legacy items whose URL could not be reconstructed (F-RUN-6) are shown by filename.
      url: row.url ?? row.filename,
      kind: row.kind,
      viewportSlug: row.viewport_slug,
      status: row.status,
      width: row.width,
      height: row.height,
      truncated: row.truncated,
      error: row.error,
      imageUrl:
        row.kind === 'page' && row.status === 'done' && row.r2_key
          ? await imageUrl(row.r2_key)
          : null,
    })),
  );
  return { rows, total: count ?? 0 };
}

const FAILURE_LIMIT = 1000;

/** Failed items grouped by error message (F-RUN-3 Failures tab), first `FAILURE_LIMIT`. */
export async function getFailureGroups(runId: string): Promise<FailureGroup[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('run_items')
    .select('id, url, filename, viewport_slug, error')
    .eq('run_id', runId)
    .eq('status', 'failed')
    .order('url')
    .limit(FAILURE_LIMIT);
  if (error) throw new Error(`Could not load failed items: ${error.message}`);
  return groupFailures(
    data.map((row) => ({
      id: row.id,
      // Legacy items whose URL could not be reconstructed (F-RUN-6) are shown by filename.
      url: row.url ?? row.filename,
      viewportSlug: row.viewport_slug,
      error: row.error,
    })),
  );
}

/** Mean duration of one capture in the project's latest finished runs, for the estimate. */
export async function averageItemMs(projectId: string): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('runs')
    .select('started_at, finished_at, done_items, failed_items, settings')
    .eq('project_id', projectId)
    .in('status', ['completed', 'completed_with_errors'])
    .not('started_at', 'is', null)
    .not('finished_at', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) throw new Error(`Could not load finished runs: ${error.message}`);
  let ms = 0;
  let items = 0;
  for (const run of data) {
    const processed = run.done_items + run.failed_items;
    const concurrency = Number(
      (run.settings as { captureConcurrency?: number })?.captureConcurrency,
    );
    if (processed === 0) continue;
    const elapsed = Date.parse(run.finished_at!) - Date.parse(run.started_at!);
    ms += elapsed * (Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 1);
    items += processed;
  }
  return items > 0 ? Math.round(ms / items) : null;
}

/** The project's baseline run id (02 §2 `projects.baseline_run_id`). */
export async function getBaselineRunId(projectId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects_public')
    .select('baseline_run_id')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the baseline: ${error.message}`);
  return data?.baseline_run_id ?? null;
}
