import 'server-only';
import type { Json } from '@vrt/db';
import type { IgnoreRule } from '@vrt/engine';
import type { ItemKind, RunStatus, StartRunResponse } from '@vrt/shared';
import { audit } from '../audit';
import { assertCan } from '../auth/assert-can';
import type { CurrentUser } from '../auth/session';
import { ForbiddenError } from '../auth/assert-can';
import { RequestError } from '../members/errors';
import { createClient } from '../supabase/server';
import { workerClient } from '../worker-client';
import {
  createRunCommands,
  LabelTakenError,
  type RunsGateway,
  type StartRunInput,
} from './commands';

type UserClient = Awaited<ReturnType<typeof createClient>>;

const PAGE = 1000;
const INSERT_CHUNK = 500;

function check<T>(what: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Could not ${what}: ${result.error.message}`);
  return result.data;
}

function list<T>(what: string, result: { data: T[] | null; error: { message: string } | null }) {
  return check(what, result) ?? [];
}

/** `RunsGateway` as the signed-in user: every read and write goes through RLS. */
function supabaseGateway(supabase: UserClient): RunsGateway {
  return {
    async loadProject(projectId) {
      const row = check(
        'load the project',
        await supabase
          .from('projects_public')
          .select(
            'id, slug, archived_at, check_redirects, capture_concurrency, settle_ms, ' +
              'page_timeout_ms, max_page_height, extra_css, hide_selectors, file_extensions',
          )
          .eq('id', projectId)
          .maybeSingle(),
      ) as Record<string, Json> | null;
      if (!row?.id) return null;
      return {
        id: row.id as string,
        slug: row.slug as string,
        archived: row.archived_at !== null,
        capture: {
          checkRedirects: row.check_redirects ?? null,
          captureConcurrency: row.capture_concurrency ?? null,
          settleMs: row.settle_ms ?? null,
          pageTimeoutMs: row.page_timeout_ms ?? null,
          maxPageHeight: row.max_page_height ?? null,
          extraCss: row.extra_css ?? null,
          hideSelectors: row.hide_selectors ?? [],
          fileExtensions: row.file_extensions ?? null,
        },
      };
    },

    async loadViewports(projectId) {
      const rows = list(
        'load viewports',
        await supabase
          .from('viewports')
          .select('slug, width, height, device_scale_factor, is_mobile, enabled, sort_order')
          .eq('project_id', projectId)
          .order('sort_order'),
      );
      return rows.map((v) => ({
        slug: v.slug,
        width: v.width,
        height: v.height,
        deviceScaleFactor: Number(v.device_scale_factor),
        isMobile: v.is_mobile,
        enabled: v.enabled,
      }));
    },

    async loadSnapshot(projectId, snapshotId) {
      return check(
        'load the snapshot',
        await supabase
          .from('sitemap_snapshots')
          .select('status')
          .eq('project_id', projectId)
          .eq('id', snapshotId)
          .maybeSingle(),
      );
    },

    async loadSnapshotUrls(snapshotId) {
      const urls: { url: string; kind: ItemKind }[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const rows = list(
          'load snapshot URLs',
          await supabase
            .from('sitemap_urls')
            .select('url, kind')
            .eq('snapshot_id', snapshotId)
            .eq('included', true)
            .order('url')
            .range(offset, offset + PAGE - 1),
        );
        urls.push(...rows);
        if (rows.length < PAGE) return urls;
      }
    },

    async loadIgnoreRules(projectId) {
      const rows = list(
        'load ignore rules',
        await supabase
          .from('ignore_rules')
          .select('type, url_pattern, selector, region, viewport_slug, applies_to, enabled')
          .eq('project_id', projectId)
          .eq('enabled', true),
      );
      return rows as unknown as IgnoreRule[];
    },

    async findActiveRun(projectId) {
      const rows = list(
        'check active runs',
        await supabase
          .from('runs')
          .select('id, label')
          .eq('project_id', projectId)
          .in('status', ['queued', 'running'])
          .order('created_at')
          .limit(1),
      );
      return rows[0] ?? null;
    },

    async labelsStartingWith(projectId, prefix) {
      const rows = list(
        'load run labels',
        await supabase
          .from('runs')
          .select('label')
          .eq('project_id', projectId)
          .like('label', `${prefix}%`),
      );
      return rows.map((r) => r.label);
    },

    async insertRun(run) {
      const { data, error } = await supabase
        .from('runs')
        .insert({
          project_id: run.projectId,
          label: run.label,
          status: 'queued',
          snapshot_id: run.snapshotId,
          viewport_slugs: run.viewportSlugs,
          settings: run.settings ?? {},
          note: run.note,
          started_by: run.startedBy,
        })
        .select('id')
        .single();
      if (error?.code === '23505') throw new LabelTakenError(error.message);
      if (error?.code === '42501') throw new RequestError(403, 'forbidden', error.message);
      if (error) throw new Error(`Could not create the run: ${error.message}`);
      return data;
    },

    async insertItems(runId, items) {
      for (let i = 0; i < items.length; i += INSERT_CHUNK) {
        check(
          'create run items',
          await supabase.from('run_items').insert(
            items.slice(i, i + INSERT_CHUNK).map((item) => ({
              run_id: runId,
              url: item.url,
              kind: item.kind,
              viewport_slug: item.viewportSlug,
              filename: item.filename,
            })),
          ),
        );
      }
    },

    async loadRun(runId) {
      const row = check(
        'load the run',
        await supabase
          .from('runs')
          .select('id, project_id, label, status, cancel_requested_at')
          .eq('id', runId)
          .maybeSingle(),
      );
      if (!row) return null;
      return {
        id: row.id,
        projectId: row.project_id,
        label: row.label,
        status: row.status as RunStatus,
        cancelRequestedAt: row.cancel_requested_at,
      };
    },

    async updateRun(runId, patch) {
      check('update the run', await supabase.from('runs').update(patch).eq('id', runId));
    },

    async updateItems(runId, from, patch) {
      const rows = list(
        'update run items',
        await supabase
          .from('run_items')
          .update(patch)
          .eq('run_id', runId)
          .in('status', from)
          .select('id'),
      );
      return rows.length;
    },

    async setBaseline(projectId, runId) {
      const { error } = await supabase.rpc('set_baseline', {
        p_project_id: projectId,
        p_run_id: runId,
      });
      if (!error) return;
      if (error.code === '42501') throw new RequestError(403, 'forbidden', error.message);
      if (error.code === 'P0002') throw new RequestError(404, 'not_found', 'Run not found');
      if (error.code === '23514') throw new RequestError(422, 'business_rule', error.message);
      throw new Error(`Could not set the baseline: ${error.message}`);
    },

    audit: (action, projectId, details) => audit(supabase, action, projectId, details),
  };
}

async function commands(user: CurrentUser | null) {
  if (!user) throw new ForbiddenError('run.manage');
  const supabase = await createClient();
  return createRunCommands({
    authorize: async (action, projectId) => {
      await assertCan(user, action, projectId);
    },
    db: supabaseGateway(supabase),
    worker: workerClient(),
  });
}

/** F-RUN-1/2/5: editor+ creates a capture run (or lists its items for a dry run). */
export async function startRun(
  user: CurrentUser | null,
  projectId: string,
  input: StartRunInput,
): Promise<StartRunResponse> {
  return (await commands(user)).startRun(projectId, user!.id, input);
}

/** F-RUN-4: editor+ cancels a queued or running run. */
export async function cancelRun(user: CurrentUser | null, runId: string): Promise<void> {
  return (await commands(user)).cancelRun(runId);
}

/** F-RUN-4, 06 §4: editor+ re-captures the failed items of a finished run. */
export async function retryFailed(
  user: CurrentUser | null,
  runId: string,
): Promise<{ workflowId: string }> {
  return (await commands(user)).retryFailed(runId);
}

/** F-RUN-4, F-REVIEW-5: editor+ makes a completed run the project's baseline. */
export async function setBaseline(user: CurrentUser | null, runId: string): Promise<void> {
  return (await commands(user)).setBaseline(runId);
}
