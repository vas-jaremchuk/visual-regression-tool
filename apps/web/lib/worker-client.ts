import 'server-only';
import {
  healthResponse,
  jobStartedResponse,
  jobStatusResponse,
  parseEnv,
  signRequest,
  webEnv,
  type DeleteJob,
  type ImportLegacyJob,
  type JobStartedResponse,
  type StartCaptureJob,
  type StartCompareJob,
  type StartSitemapJob,
  type StorageJob,
} from '@vrt/shared';
import type { z } from 'zod';

/**
 * Server-only client for the worker HTTP API (09 §2). Every `/jobs/*` call is signed with
 * VRT-HMAC over `WORKER_SHARED_SECRET` (04 §6); bodies carry ids only.
 */

export interface WorkerClientOptions {
  baseUrl: string;
  secret: string;
  fetch?: typeof fetch;
}

export class WorkerRequestError extends Error {
  readonly status: number;

  constructor(method: string, path: string, status: number, body: string) {
    super(`Worker ${method} ${path} failed with ${status}: ${body.slice(0, 500)}`);
    this.name = 'WorkerRequestError';
    this.status = status;
  }
}

export type WorkerClient = ReturnType<typeof createWorkerClient>;

export function createWorkerClient({
  baseUrl,
  secret,
  fetch: fetchFn = fetch,
}: WorkerClientOptions) {
  const origin = baseUrl.replace(/\/+$/, '');

  async function send(
    method: 'GET' | 'POST',
    path: string,
    payload?: unknown,
    signed = true,
  ): Promise<Response> {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (signed) headers.authorization = await signRequest({ secret, method, path, body });

    const res = await fetchFn(origin + path, { method, headers, body, cache: 'no-store' });
    if (!res.ok) throw new WorkerRequestError(method, path, res.status, await res.text());
    return res;
  }

  async function request<T extends z.ZodType>(
    schema: T,
    method: 'GET' | 'POST',
    path: string,
    payload?: unknown,
    signed = true,
  ): Promise<z.infer<T>> {
    const res = await send(method, path, payload, signed);
    return schema.parse(await res.json());
  }

  const start = (path: string, payload: unknown): Promise<JobStartedResponse> =>
    request(jobStartedResponse, 'POST', path, payload);

  return {
    startSitemap: (input: StartSitemapJob) => start('/jobs/sitemap', input),
    startCapture: (input: StartCaptureJob) => start('/jobs/capture', input),
    cancelCapture: async (runId: string): Promise<void> => {
      await send('POST', `/jobs/capture/${encodeURIComponent(runId)}/cancel`);
    },
    startCompare: (input: StartCompareJob) => start('/jobs/compare', input),
    startDelete: (input: DeleteJob) => start('/jobs/delete', input),
    startImportLegacy: (input: ImportLegacyJob) => start('/jobs/import-legacy', input),
    startStorage: (input: StorageJob) => start('/jobs/storage', input),
    getJobStatus: (workflowId: string) =>
      request(jobStatusResponse, 'GET', `/jobs/${encodeURIComponent(workflowId)}`),
    health: () => request(healthResponse, 'GET', '/health', undefined, false),
  };
}

let defaultClient: WorkerClient | undefined;

/** The worker client configured from the validated web env (`WORKER_URL`, `WORKER_SHARED_SECRET`). */
export function workerClient(): WorkerClient {
  if (!defaultClient) {
    const env = parseEnv(webEnv, process.env, 'web');
    defaultClient = createWorkerClient({
      baseUrl: env.WORKER_URL,
      secret: env.WORKER_SHARED_SECRET,
    });
  }
  return defaultClient;
}
