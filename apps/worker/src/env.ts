import { parseEnv, workerEnv, type WorkerEnv } from '@vrt/shared';
import type { DiffContainer } from './containers/diff-container';
import type { ProjectLimiter } from './limiter/project-limiter';
import type { CaptureMsg, DiffMsg } from '@vrt/shared';

/** Cloudflare bindings declared in `wrangler.jsonc` (03 §3) plus the secrets validated by `workerEnv`. */
export interface Env extends Partial<Record<keyof WorkerEnv, string>> {
  BROWSER: Fetcher;
  CAPTURE_RUN: Workflow;
  COMPARE_RUN: Workflow;
  SITEMAP_FETCH: Workflow;
  DELETE_JOB: Workflow;
  STORAGE_USAGE: Workflow;
  LEGACY_IMPORT: Workflow;
  CAPTURE_QUEUE: Queue<CaptureMsg>;
  DIFF_QUEUE: Queue<DiffMsg>;
  DIFF_CONTAINER: DurableObjectNamespace<DiffContainer>;
  PROJECT_LIMITER: DurableObjectNamespace<ProjectLimiter>;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
}

const cache = new WeakMap<object, WorkerEnv>();

/**
 * Validates the worker's secrets with `workerEnv` (03 §4). The env object is stable per isolate,
 * so the result is cached and validation runs once at startup; a bad env throws on every request.
 */
export function getConfig(env: Env): WorkerEnv {
  let config = cache.get(env);
  if (!config) {
    config = parseEnv(workerEnv, env as unknown as Record<string, unknown>, 'worker');
    cache.set(env, config);
  }
  return config;
}

export function workerVersion(env: Env): string {
  return env.CF_VERSION_METADATA?.id || 'dev';
}
