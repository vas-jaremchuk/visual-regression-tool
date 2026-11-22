import 'server-only';
import type { IgnoreRuleType, Region } from '@vrt/shared';
import { createClient } from '../supabase/server';

export interface IgnoreRuleRow {
  id: string;
  type: IgnoreRuleType;
  urlPattern: string | null;
  selector: string | null;
  region: Region | null;
  viewportSlug: string | null;
  appliesTo: 'capture' | 'compare' | 'both';
  enabled: boolean;
  reason: string | null;
  author: string | null;
  createdAt: string;
}

/** F-IGNORE-1: the project's ignore rules, oldest first (RLS: viewer+). */
export async function listIgnoreRules(projectId: string): Promise<IgnoreRuleRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ignore_rules')
    .select(
      'id, type, url_pattern, selector, region, viewport_slug, applies_to, enabled, reason, created_at, profiles(email, full_name)',
    )
    .eq('project_id', projectId)
    .order('created_at')
    .order('id');
  if (error) throw new Error(`Could not load the ignore rules: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    type: row.type,
    urlPattern: row.url_pattern,
    selector: row.selector,
    region: row.region as Region | null,
    viewportSlug: row.viewport_slug,
    appliesTo: row.applies_to as IgnoreRuleRow['appliesTo'],
    enabled: row.enabled,
    reason: row.reason,
    author: row.profiles ? (row.profiles.full_name ?? row.profiles.email) : null,
    createdAt: row.created_at,
  }));
}
