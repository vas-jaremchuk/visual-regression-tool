import { Container } from '@cloudflare/containers';
import type { WorkerEnv } from '@vrt/shared';
import { getConfig, type Env } from '../env';

export const DIFF_CONTAINER_PORT = 8080;

/**
 * Variables the container process needs (validated there by `containerEnv`). The container does
 * not see worker bindings, so only these are forwarded; the Supabase key never leaves the worker.
 */
export function diffContainerEnvVars(config: WorkerEnv): Record<string, string> {
  return {
    CF_ACCOUNT_ID: config.CF_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: config.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: config.R2_SECRET_ACCESS_KEY,
    DIFF_CONTAINER_SHARED_SECRET: config.DIFF_CONTAINER_SHARED_SECRET,
    PORT: String(DIFF_CONTAINER_PORT),
  };
}

/**
 * Durable Object fronting the `apps/diff-container` image (03 §3, ADR-2), which serves
 * `GET /health` and bearer-authenticated `POST /diff` (09 §4). Calling it is T15's diff consumer.
 */
export class DiffContainer extends Container<Env> {
  override defaultPort = DIFF_CONTAINER_PORT;
  override sleepAfter = '5m';
  override pingEndpoint = 'localhost/health';

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env, { envVars: diffContainerEnvVars(getConfig(env)) });
  }
}
