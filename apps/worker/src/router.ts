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
import { getConfig, workerVersion, type Env } from './env';
import { createLogger, type Logger } from './logger';

/** Worker HTTP API (09 §2). `/jobs/*` requires a VRT-HMAC signature (04 §6); `/health` does not. */

const json = (body: unknown, status = 200) => Response.json(body, { status });

function apiError(code: ApiErrorCode, message: string, details?: unknown): Response {
  const body: ApiErrorResponse = { error: { code, message, details } };
  return json(body, API_ERROR_STATUS[code]);
}

interface JobRequest {
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

const routes: { method: string; pattern: RegExp; handler: JobHandler }[] = [
  { method: 'POST', pattern: /^\/jobs\/sitemap$/, handler: startJob('sitemap', startSitemapJob) },
  { method: 'POST', pattern: /^\/jobs\/capture$/, handler: startJob('capture', startCaptureJob) },
  {
    method: 'POST',
    pattern: /^\/jobs\/capture\/([^/]+)\/cancel$/,
    handler: ({ log }, [runId]) => {
      if (!id.safeParse(runId).success) return apiError('validation_error', 'runId must be a UUID');
      log.info('stub capture cancel', { runId });
      return new Response(null, { status: 202 });
    },
  },
  { method: 'POST', pattern: /^\/jobs\/compare$/, handler: startJob('compare', startCompareJob) },
  { method: 'POST', pattern: /^\/jobs\/delete$/, handler: startJob('delete', deleteJob) },
  {
    method: 'POST',
    pattern: /^\/jobs\/import-legacy$/,
    handler: startJob('import-legacy', importLegacyJob),
  },
  { method: 'POST', pattern: /^\/jobs\/storage$/, handler: startJob('storage', storageJob) },
  {
    method: 'GET',
    pattern: /^\/jobs\/([^/]+)$/,
    handler: (_req, [workflowId]) => json({ status: 'unknown', workflowId, stub: true }),
  },
];

async function handleJobs(request: Request, url: URL, config: WorkerEnv, log: Logger) {
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
      { method: request.method, path, body, log },
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
      return await handleJobs(request, url, config, log);
    }
    return apiError('not_found', 'Not found');
  } catch (error) {
    log.error('unhandled error', { error });
    return apiError('internal_error', 'Internal error');
  }
}
