import 'server-only';
import {
  storageGroupUsage,
  type ComparisonStatus,
  type RunStatus,
  type StorageGroupUsage,
} from '@vrt/shared';
import { z } from 'zod';
import { createClient } from '../supabase/server';

/** Storage page (F-STORAGE-1/2/5) and admin storage (F-STORAGE-4), as the user sees them. */

export const STORAGE_LIST_LIMIT = 500;

export interface StorageUsageRow {
  projectId: string;
  bucket: string;
  status: 'running' | 'completed' | 'failed';
  totalBytes: number;
  objectCount: number;
  groups: StorageGroupUsage[];
  error: string | null;
  refreshedAt: string | null;
  updatedAt: string;
}

export interface StorageRun {
  id: string;
  label: string;
  status: RunStatus;
  note: string | null;
  isBaseline: boolean;
  bytes: number;
  objects: number;
}

export interface StorageComparison {
  id: string;
  label: string;
  status: ComparisonStatus;
}

const groups = z.array(storageGroupUsage).catch([]);

function toUsage(row: Record<string, unknown>): StorageUsageRow {
  return {
    projectId: row.project_id as string,
    bucket: row.bucket as string,
    status: row.status as StorageUsageRow['status'],
    totalBytes: Number(row.total_bytes ?? 0),
    objectCount: Number(row.object_count ?? 0),
    groups: groups.parse(row.groups),
    error: (row.error as string | null) ?? null,
    refreshedAt: (row.refreshed_at as string | null) ?? null,
    updatedAt: row.updated_at as string,
  };
}

const USAGE_COLUMNS =
  'project_id, bucket, status, total_bytes, object_count, groups, error, refreshed_at, updated_at';

export async function getStorageUsage(projectId: string): Promise<StorageUsageRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('storage_usage')
    .select(USAGE_COLUMNS)
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) throw new Error(`Could not load storage usage: ${error.message}`);
  return data ? toUsage(data) : null;
}

/** Runs newest first with their size from `run_sizes` (sum of `run_items.bytes`). */
export async function listStorageRuns(projectId: string): Promise<StorageRun[]> {
  const supabase = await createClient();
  const [{ data, error }, project] = await Promise.all([
    supabase
      .from('runs')
      .select('id, label, status, note')
      .eq('project_id', projectId)
      .order('label', { ascending: false })
      .limit(STORAGE_LIST_LIMIT),
    supabase.from('projects_public').select('baseline_run_id').eq('id', projectId).maybeSingle(),
  ]);
  if (error) throw new Error(`Could not load runs: ${error.message}`);
  if (project.error) throw new Error(`Could not load the project: ${project.error.message}`);
  const baselineRunId = project.data?.baseline_run_id ?? null;
  const runs = data ?? [];
  const sizes = new Map<string, { bytes: number; objects: number }>();
  if (runs.length > 0) {
    const result = await supabase
      .from('run_sizes')
      .select('run_id, bytes, objects')
      .in(
        'run_id',
        runs.map((r) => r.id),
      );
    if (result.error) throw new Error(`Could not load run sizes: ${result.error.message}`);
    for (const row of result.data ?? []) {
      sizes.set(row.run_id!, { bytes: Number(row.bytes ?? 0), objects: row.objects ?? 0 });
    }
  }
  return runs.map((run) => ({
    id: run.id,
    label: run.label,
    status: run.status as RunStatus,
    note: run.note,
    isBaseline: run.id === baselineRunId,
    ...(sizes.get(run.id) ?? { bytes: 0, objects: 0 }),
  }));
}

export async function listStorageComparisons(projectId: string): Promise<StorageComparison[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('comparisons')
    .select('id, label, status')
    .eq('project_id', projectId)
    .order('label', { ascending: false })
    .limit(STORAGE_LIST_LIMIT);
  if (error) throw new Error(`Could not load comparisons: ${error.message}`);
  return (data ?? []).map((c) => ({
    id: c.id,
    label: c.label,
    status: c.status as ComparisonStatus,
  }));
}

export interface ProjectStorage {
  id: string;
  slug: string;
  name: string;
  bucket: string;
  archived: boolean;
  usage: StorageUsageRow | null;
}

/** F-STORAGE-4: every project with its cached usage (platform admins see all of them). */
export async function listAllProjectStorage(): Promise<ProjectStorage[]> {
  const supabase = await createClient();
  const [projects, usage] = await Promise.all([
    supabase.from('projects_public').select('id, slug, name, r2_bucket, archived_at').order('name'),
    supabase.from('storage_usage').select(USAGE_COLUMNS),
  ]);
  if (projects.error) throw new Error(`Could not load projects: ${projects.error.message}`);
  if (usage.error) throw new Error(`Could not load storage usage: ${usage.error.message}`);
  const byProject = new Map((usage.data ?? []).map((row) => [row.project_id, toUsage(row)]));
  return (projects.data ?? []).map((p) => ({
    id: p.id!,
    slug: p.slug!,
    name: p.name!,
    bucket: p.r2_bucket!,
    archived: p.archived_at !== null,
    usage: byProject.get(p.id!) ?? null,
  }));
}
