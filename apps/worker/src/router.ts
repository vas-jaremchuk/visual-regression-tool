import {
  API_ERROR_STATUS,
  deleteJob,
  id,
  importLegacyJob,
  startCaptureJob,
  startCompareJob,
  startSitemapJob,
  storageJob,
  verifyRequest,
  type ApiErrorCode,
  type ApiErrorResponse,
  type JobStartedResponse,
  type WorkerEnv,
} from '@vrt/shared';
import type { z } from 'zod';
import { createRunJob } from './capture/run-job';
import { getConfig, workerVersion, type Env } from './env';
import { createLogger, type Logger } from './logger';
import { runJobDeps } from './workflows/capture-run';

/** Worker HTTP API (09 §2). `/jobs/*` requires a VRT-HMAC signature (04 §6); `/health` does not. */

const json = (body: unknown, status = 200) => Response.json(body, { status });

function apiError(code: ApiErrorCode, message: string, details?: unknown): Response {
  const body: ApiErrorResponse = { error: { code, message, details } };
  return json(body, API_ERROR_STATUS[code]);
}

interface JobRequest {
  env: Env;
  method: string;
  path: string;
  body: Uint8Array<ArrayBuffer>;
  log: Logger;
}

type JobHandler = (req: JobRequest, params: string[]) => Promise<Response> | Response;

function parseBody<T extends z.ZodType>(schema: T, body: Uint8Array): z.infer<T> | Response {
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return apiError('validation_error', 'Request body must be JSON');
  }
  const result = schema.safeParse(data);
  if (!result.success)
    return apiError('validation_error', 'Invalid request body', result.error.issues);
  return result.data;
}

/**
 * Start-job stubs: validate the ids-only body and answer with a placeholder workflow id.
 * Creating the Workflow instance is real job logic and belongs to T10+.
 */
function startJob(job: string, schema: z.ZodType): JobHandler {
  return ({ body, log }) => {
    const parsed = parseBody(schema, body);
    if (parsed instanceof Response) return parsed;
    const response: JobStartedResponse = { workflowId: `stub-${crypto.randomUUID()}` };
    log.info('stub job started', { job, ...(parsed as object), ...response });
    return json(response);
  };
}

/**
 * POST /jobs/sitemap: one `SitemapWorkflow` instance per snapshot, named after it, so a repeated
 * request does not start a second fetch.
 */
const startSitemap: JobHandler = async ({ env, body, log }) => {
  const parsed = parseBody(startSitemapJob, body);
  if (parsed instanceof Response) return parsed;
  let instance: WorkflowInstance;
  try {
    instance = await env.SITEMAP_FETCH.create({ id: parsed.snapshotId, params: parsed });
  } catch (error) {
    if (!/already.exists/i.test(String(error))) throw error;
    instance = await env.SITEMAP_FETCH.get(parsed.snapshotId);
  }
  const response: JobStartedResponse = { workflowId: instance.id };
  log.info('sitemap workflow started', { ...parsed, ...response });
  return json(response);
};

/** POST /jobs/import-legacy (F-RUN-6): one `ImportWorkflow` instance per request. */
const startImportLegacy: JobHandler = async ({ env, body, log }) => {
  const parsed = parseBody(importLegacyJob, body);
  if (parsed instanceof Response) return parsed;
  const instance = await env.LEGACY_IMPORT.create({
    id: `${parsed.projectId}-${Date.now().toString(36)}`,
    params: parsed,
  });
  const response: JobStartedResponse = { workflowId: instance.id };
  log.info('legacy import workflow started', { ...parsed, ...response });
  return json(response);
};

/** Workflow instance statuses that will still make progress on their own. */
const LIVE_STATUSES = new Set(['queued', 'running', 'paused', 'waiting', 'waitingForPause']);

async function isLive(instance: WorkflowInstance): Promise<boolean> {
  return LIVE_STATUSES.has((await instance.status()).status);
}

/**
 * POST /jobs/capture: the first `CaptureRunWorkflow` instance of a run is named after it, so a
 * repeated request does not start a second one while it is alive. Once it has ended, a request
 * (retry failed, 06 §4) starts a new instance for the same run.
 */
const startCapture: JobHandler = async ({ env, body, log }) => {
  const parsed = parseBody(startCaptureJob, body);
  if (parsed instanceof Response) return parsed;
  let instance: WorkflowInstance;
  try {
    instance = await env.CAPTURE_RUN.create({ id: parsed.runId, params: parsed });
  } catch (error) {
    if (!/already.exists/i.test(String(error))) throw error;
    instance = await env.CAPTURE_RUN.get(parsed.runId);
    if (!(await isLive(instance))) {
      instance = await env.CAPTURE_RUN.create({
        id: `${parsed.runId}-${Date.now().toString(36)}`,
        params: parsed,
      });
    }
  }
  const response: JobStartedResponse = { workflowId: instance.id };
  log.info('capture workflow started', { ...parsed, ...response });
  return json(response);
};

/**
 * POST /jobs/capture/:runId/cancel (06 §4): records the cancel; the live workflow finalises the
 * run as `cancelled` at its next poll, or this request does when no workflow is alive.
 */
const cancelCapture: JobHandler = async ({ env, log }, [runId]) => {
  if (!id.safeParse(runId).success) return apiError('validation_error', 'runId must be a UUID');
  const job = createRunJob(runId!, runJobDeps(env));
  try {
    await job.cancel(async (workflowId) => {
      try {
        return await isLive(await env.CAPTURE_RUN.get(workflowId));
      } catch {
        return false;
      }
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'RunNotFoundError') {
      return apiError('not_found', error.message);
    }
    throw error;
  }
  log.info('capture cancel requested', { runId });
  return new Response(null, { status: 202 });
};

const routes: { method: string; pattern: RegExp; handler: JobHandler }[] = [
  { method: 'POST', pattern: /^\/jobs\/sitemap$/, handler: startSitemap },
  { method: 'POST', pattern: /^\/jobs\/capture$/, handler: startCapture },
  { method: 'POST', pattern: /^\/jobs\/capture\/([^/]+)\/cancel$/, handler: cancelCapture },
  { method: 'POST', pattern: /^\/jobs\/compare$/, handler: startJob('compare', startCompareJob) },
  { method: 'POST', pattern: /^\/jobs\/delete$/, handler: startJob('delete', deleteJob) },
  { method: 'POST', pattern: /^\/jobs\/import-legacy$/, handler: startImportLegacy },
  { method: 'POST', pattern: /^\/jobs\/storage$/, handler: startJob('storage', storageJob) },
  {
    method: 'GET',
    pattern: /^\/jobs\/([^/]+)$/,
    handler: (_req, [workflowId]) => json({ status: 'unknown', workflowId, stub: true }),
  },
];

async function handleJobs(request: Request, url: URL, env: Env, config: WorkerEnv, log: Logger) {
  const path = url.pathname + url.search;
  const body = new Uint8Array(await request.arrayBuffer());
  const verified = await verifyRequest({
    secret: config.WORKER_SHARED_SECRET,
    method: request.method,
    path,
    body,
    header: request.headers.get('authorization'),
  });
  if (!verified.ok) {
    log.warn('rejected unsigned job request', { reason: verified.reason, path: url.pathname });
    return apiError('unauthorized', 'Invalid or missing request signature');
  }

  for (const route of routes) {
    const match = route.pattern.exec(url.pathname);
    if (!match) continue;
    if (route.method !== request.method) continue;
    return route.handler(
      { env, method: request.method, path, body, log },
      match.slice(1).map(decodeURIComponent),
    );
  }
  return apiError('not_found', 'Not found');
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const log = createLogger({ component: 'http', method: request.method, path: url.pathname });

  let config: WorkerEnv;
  try {
    config = getConfig(env);
  } catch (error) {
    log.error('invalid worker environment', { error });
    return apiError('internal_error', 'Worker is misconfigured');
  }

  try {
    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ ok: true, version: workerVersion(env) });
    }
    if (url.pathname === '/jobs' || url.pathname.startsWith('/jobs/')) {
      return await handleJobs(request, url, env, config, log);
    }
    return apiError('not_found', 'Not found');
  } catch (error) {
    log.error('unhandled error', { error });
    return apiError('internal_error', 'Internal error');
  }
}
