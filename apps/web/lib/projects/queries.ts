import 'server-only';
import type { ProjectSettings } from '@vrt/shared';
import { cache } from 'react';
import { createClient } from '../supabase/server';
import { SETTINGS_SELECT, rowToSettings } from './columns';

export interface ProjectDetail {
  id: string;
  settings: ProjectSettings;
  hasBasicAuth: boolean;
  archivedAt: string | null;
  createdAt: string;
  /** The slug is read-only once the project has a run (03 §6). */
  hasRuns: boolean;
}

export interface ViewportRow {
  id: string;
  slug: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  enabled: boolean;
  sortOrder: number;
  /** Used by a run: slug immutable, cannot be deleted (F-VIEWPORT-1). */
  used: boolean;
}

/** A project with its settings, as the signed-in user sees it (RLS). Cached per request. */
export const getProjectDetail = cache(async (slug: string): Promise<ProjectDetail | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects_public')
    .select(`id, has_basic_auth, archived_at, created_at, ${SETTINGS_SELECT}`)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`Could not load the project: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as Record<string, unknown> & {
    id: string;
    has_basic_auth: boolean | null;
    archived_at: string | null;
    created_at: string;
  };
  const { count, error: runsError } = await supabase
    .from('runs')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', row.id);
  if (runsError) throw new Error(`Could not load runs: ${runsError.message}`);
  return {
    id: row.id,
    settings: rowToSettings(row),
    hasBasicAuth: Boolean(row.has_basic_auth),
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    hasRuns: (count ?? 0) > 0,
  };
});

/** Viewports in display order, each flagged when a run used its slug. */
export async function listViewports(projectId: string): Promise<ViewportRow[]> {
  const supabase = await createClient();
  const [viewports, runs] = await Promise.all([
    supabase
      .from('viewports')
      .select('id, slug, width, height, device_scale_factor, is_mobile, enabled, sort_order')
      .eq('project_id', projectId)
      .order('sort_order')
      .order('created_at'),
    supabase.from('runs').select('viewport_slugs').eq('project_id', projectId),
  ]);
  if (viewports.error) throw new Error(`Could not load viewports: ${viewports.error.message}`);
  if (runs.error) throw new Error(`Could not load runs: ${runs.error.message}`);
  const used = new Set(runs.data.flatMap((run) => run.viewport_slugs));
  return viewports.data.map((row) => ({
    id: row.id,
    slug: row.slug,
    width: row.width,
    height: row.height,
    deviceScaleFactor: Number(row.device_scale_factor),
    isMobile: row.is_mobile,
    enabled: row.enabled,
    sortOrder: row.sort_order,
    used: used.has(row.slug),
  }));
}

export interface ActivityRow {
  id: string;
  action: string;
  actor: string | null;
  createdAt: string;
}

/** Last audit entries of a project; RLS shows them to project admins only (02 §4). */
export async function recentActivity(projectId: string, limit = 10): Promise<ActivityRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('audit_log')
    .select('id, action, created_at, profiles(email, full_name)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load activity: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    action: row.action,
    actor: row.profiles?.full_name ?? row.profiles?.email ?? null,
    createdAt: row.created_at,
  }));
}
