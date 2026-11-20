import { Container } from '@cloudflare/containers';

/** Worker variables the diff container reads (03 §3); it validates them with `containerEnv`. */
export interface DiffContainerEnv {
  CF_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  DIFF_CONTAINER_SHARED_SECRET: string;
}

export const DIFF_CONTAINER_PORT = 8080;
/** Idle time before the container stops; it scales to zero when unused (NFR-20). */
export const DIFF_CONTAINER_SLEEP_AFTER = '5m';

/** Environment passed to the container process, which has no access to worker secrets. */
export function diffContainerEnvVars(env: DiffContainerEnv): Record<string, string> {
  return {
    CF_ACCOUNT_ID: env.CF_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    DIFF_CONTAINER_SHARED_SECRET: env.DIFF_CONTAINER_SHARED_SECRET,
    PORT: String(DIFF_CONTAINER_PORT),
  };
}

/** `DIFF_CONTAINER` binding (03 §3, ADR-2): runs `apps/diff-container` for `POST /diff`. */
export class DiffContainer extends Container<DiffContainerEnv> {
  override defaultPort = DIFF_CONTAINER_PORT;
  override sleepAfter = DIFF_CONTAINER_SLEEP_AFTER;
  override pingEndpoint = 'localhost/health';

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: DiffContainerEnv) {
    super(ctx, env, { envVars: diffContainerEnvVars(env) });
  }
}
