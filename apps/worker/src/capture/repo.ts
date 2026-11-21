import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesUpdate } from '@vrt/db';
import type { IgnoreRule } from '@vrt/engine';

/** Data access of the capture consumer (06 §3). Writes use the service role (04 §6). */

export type CaptureRun = Pick<
  Tables<'runs'>,
  'id' | 'project_id' | 'label' | 'status' | 'is_legacy' | 'cancel_requested_at'
>;
export type CaptureItem = Pick<
  Tables<'run_items'>,
  'id' | 'url' | 'kind' | 'viewport_slug' | 'filename' | 'status' | 'attempts'
>;
export type CaptureProject = Pick<
  Tables<'projects'>,
  | 'id'
  | 'r2_bucket'
  | 'basic_auth_user'
  | 'basic_auth_pass_enc'
  | 'capture_concurrency'
  | 'settle_ms'
  | 'page_timeout_ms'
  | 'max_page_height'
  | 'extra_css'
  | 'hide_selectors'
>;
export type CaptureViewportRow = Pick<
  Tables<'viewports'>,
  'slug' | 'width' | 'height' | 'device_scale_factor' | 'is_mobile'
>;
export type ItemUpdate = TablesUpdate<'run_items'>;

const RUN_COLUMNS = 'id, project_id, label, status, is_legacy, cancel_requested_at';
const ITEM_COLUMNS = 'id, url, kind, viewport_slug, filename, status, attempts';
const PROJECT_COLUMNS =
  'id, r2_bucket, basic_auth_user, basic_auth_pass_enc, capture_concurrency, settle_ms, ' +
  'page_timeout_ms, max_page_height, extra_css, hide_selectors';

function check<T>(what: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

export class CaptureRepo {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async getRun(runId: string): Promise<CaptureRun | null> {
    return check(
      'load run',
      await this.db.from('runs').select(RUN_COLUMNS).eq('id', runId).maybeSingle(),
    );
  }

  async isCancelled(runId: string): Promise<boolean> {
    const run = check(
      'load run',
      await this.db
        .from('runs')
        .select('status, cancel_requested_at')
        .eq('id', runId)
        .maybeSingle(),
    );
    return !run || run.status === 'cancelled' || run.cancel_requested_at !== null;
  }

  async getItems(runId: string, itemIds: string[]): Promise<CaptureItem[]> {
    const items = check(
      'load items',
      await this.db.from('run_items').select(ITEM_COLUMNS).eq('run_id', runId).in('id', itemIds),
    );
    // Keep the message's order (pages of one viewport were batched together, 06 §2).
    const order = new Map(itemIds.map((id, i) => [id, i]));
    return (items ?? []).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }

  async getProject(projectId: string): Promise<CaptureProject | null> {
    return check(
      'load project',
      await this.db
        .from('projects')
        .select(PROJECT_COLUMNS)
        .eq('id', projectId)
        .maybeSingle<CaptureProject>(),
    );
  }

  async getViewports(projectId: string): Promise<CaptureViewportRow[]> {
    const rows = check(
      'load viewports',
      await this.db
        .from('viewports')
        .select('slug, width, height, device_scale_factor, is_mobile')
        .eq('project_id', projectId),
    );
    return rows ?? [];
  }

  /** Enabled `selector` rules that apply to capture (05 §4 step 3). */
  async getCaptureRules(projectId: string): Promise<IgnoreRule[]> {
    const rules = check(
      'load ignore rules',
      await this.db
        .from('ignore_rules')
        .select('type, url_pattern, selector, viewport_slug, applies_to, enabled')
        .eq('project_id', projectId)
        .eq('type', 'selector')
        .eq('enabled', true)
        .in('applies_to', ['capture', 'both']),
    );
    return (rules ?? []) as IgnoreRule[];
  }

  /**
   * Marks the item `processing` with `attempts + 1`, only if nobody changed it since it was read.
   * Returns false when another delivery got there first.
   */
  async claim(item: CaptureItem): Promise<boolean> {
    const rows = check(
      'claim item',
      await this.db
        .from('run_items')
        .update({ status: 'processing', attempts: item.attempts + 1 })
        .eq('id', item.id)
        .eq('status', item.status)
        .eq('attempts', item.attempts)
        .select('id'),
    );
    return (rows ?? []).length > 0;
  }

  async update(itemId: string, patch: ItemUpdate): Promise<void> {
    check('update item', await this.db.from('run_items').update(patch).eq('id', itemId));
  }

  /** Cancelled run: items of the message that are not final become `skipped` (06 §3 step 1). */
  async skip(runId: string, itemIds: string[]): Promise<void> {
    check(
      'skip items',
      await this.db
        .from('run_items')
        .update({ status: 'skipped' })
        .eq('run_id', runId)
        .in('id', itemIds)
        .in('status', ['pending', 'processing']),
    );
  }

  async refreshCounts(runId: string): Promise<void> {
    check('refresh run counts', await this.db.rpc('refresh_run_counts', { p_run_id: runId }));
  }
}
