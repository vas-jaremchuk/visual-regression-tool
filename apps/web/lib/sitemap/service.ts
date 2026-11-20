import 'server-only';
import { lookup } from 'node:dns/promises';
import {
  MINUTE_MS,
  SsrfBlockedError,
  assertPublicUrl,
  httpUrl,
  parseAllowHosts,
} from '@vrt/shared';
import { z } from 'zod';
import { audit } from '../audit';
import { assertCan } from '../auth/assert-can';
import type { CurrentUser } from '../auth/session';
import { serverEnv } from '../env';
import { RequestError } from '../members/errors';
import { createClient } from '../supabase/server';
import { workerClient } from '../worker-client';

type UserClient = Awaited<ReturnType<typeof createClient>>;

/** A `running` snapshot younger than this blocks a new fetch (its workflow may still be alive). */
export const RUNNING_SNAPSHOT_LOCK_MS = 15 * MINUTE_MS;

const manualUrlInput = z.object({
  url: httpUrl.max(2_048),
  note: z.string().trim().max(500).optional(),
});

async function resolveHost(hostname: string): Promise<string[]> {
  const addresses = await lookup(hostname, { all: true });
  return addresses.map((entry) => entry.address);
}

async function loadProject(supabase: UserClient, projectId: string) {
  const { data, error } = await supabase
    .from('projects_public')
    .select('id, sitemap_index, archived_at')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the project: ${error.message}`);
  if (!data?.id) throw new RequestError(404, 'not_found', 'Project not found');
  if (data.archived_at) {
    throw new RequestError(422, 'business_rule', 'The project is archived; unarchive it first');
  }
  return { id: data.id, sitemapIndex: data.sitemap_index ?? '' };
}

/** NFR-14: the sitemap index must point to a public host before the worker fetches it. */
async function assertFetchable(url: string) {
  try {
    await assertPublicUrl(url, {
      resolve: resolveHost,
      allowHosts: parseAllowHosts(serverEnv().SSRF_ALLOW_HOSTS),
    });
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      throw new RequestError(422, 'business_rule', error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new RequestError(422, 'business_rule', `Cannot fetch ${url}: ${message}`);
  }
}

/**
 * F-SITEMAP-1: creates a `running` snapshot and starts the SitemapWorkflow. One running fetch
 * per project at a time (a stuck snapshot older than 15 minutes no longer blocks).
 */
export async function startSnapshot(
  user: CurrentUser | null,
  projectId: string,
): Promise<{ snapshotId: string; workflowId: string }> {
  const actor = await assertCan(user, 'sitemap.manage', projectId);
  const supabase = await createClient();
  const project = await loadProject(supabase, projectId);
  await assertFetchable(project.sitemapIndex);

  const since = new Date(Date.now() - RUNNING_SNAPSHOT_LOCK_MS).toISOString();
  const { data: running, error: runningError } = await supabase
    .from('sitemap_snapshots')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'running')
    .gte('created_at', since)
    .limit(1);
  if (runningError) throw new Error(`Could not check snapshots: ${runningError.message}`);
  if (running.length > 0) {
    throw new RequestError(409, 'conflict', 'A sitemap fetch is already running for this project');
  }

  const { data: snapshot, error } = await supabase
    .from('sitemap_snapshots')
    .insert({
      project_id: projectId,
      status: 'running',
      source_url: project.sitemapIndex,
      started_by: actor.id,
    })
    .select('id')
    .single();
  if (error?.code === '42501') throw new RequestError(403, 'forbidden', error.message);
  if (error) throw new Error(`Could not create the snapshot: ${error.message}`);

  let workflowId: string;
  try {
    ({ workflowId } = await workerClient().startSitemap({ snapshotId: snapshot.id }));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await supabase
      .from('sitemap_snapshots')
      .update({
        status: 'failed',
        error: `Could not start the sitemap job: ${message}`.slice(0, 1_000),
        finished_at: new Date().toISOString(),
      })
      .eq('id', snapshot.id);
    console.error(cause);
    throw new RequestError(
      502,
      'worker_unavailable',
      'Could not start the sitemap job. Try again.',
    );
  }

  await audit(supabase, 'sitemap.fetch', projectId, { snapshotId: snapshot.id, workflowId });
  return { snapshotId: snapshot.id, workflowId };
}

/** F-SITEMAP-4: adds a URL merged into every future snapshot. */
export async function addManualUrl(
  user: CurrentUser | null,
  projectId: string,
  input: { url: string; note?: string },
): Promise<{ id: string }> {
  await assertCan(user, 'sitemap.manage', projectId);
  const parsed = manualUrlInput.safeParse(input);
  if (!parsed.success) {
    throw new RequestError(400, 'validation', parsed.error.issues[0]?.message ?? 'Invalid URL');
  }
  const supabase = await createClient();
  await loadProject(supabase, projectId);
  const { url, note } = parsed.data;
  const { data, error } = await supabase
    .from('project_manual_urls')
    .insert({ project_id: projectId, url, note: note || null })
    .select('id')
    .single();
  if (error?.code === '23505') {
    throw new RequestError(409, 'conflict', `${url} is already a manual URL`);
  }
  if (error?.code === '42501') throw new RequestError(403, 'forbidden', error.message);
  if (error) throw new Error(`Could not add the URL: ${error.message}`);
  await audit(supabase, 'sitemap.manual_url.add', projectId, { id: data.id, url });
  return { id: data.id };
}

/** F-SITEMAP-4: removes a manual URL; existing snapshots keep it. */
export async function removeManualUrl(
  user: CurrentUser | null,
  projectId: string,
  manualUrlId: string,
): Promise<void> {
  await assertCan(user, 'sitemap.manage', projectId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_manual_urls')
    .delete()
    .eq('project_id', projectId)
    .eq('id', manualUrlId)
    .select('url');
  if (error) throw new Error(`Could not remove the URL: ${error.message}`);
  if (data.length === 0) throw new RequestError(404, 'not_found', 'Manual URL not found');
  await audit(supabase, 'sitemap.manual_url.remove', projectId, {
    id: manualUrlId,
    url: data[0]!.url,
  });
}
