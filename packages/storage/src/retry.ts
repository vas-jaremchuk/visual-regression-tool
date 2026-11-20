import { R2_MAX_ATTEMPTS, R2_RETRY_BACKOFF_MS } from '@vrt/shared';
import { StorageError } from './errors';

/** Statuses retried per NFR-9 (prototype `upload`, plus 521). */
export const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([
  429, 500, 502, 503, 504, 520, 521, 522, 523, 524,
]);

export type Fetcher = typeof fetch;
export type Sleep = (ms: number) => Promise<void>;

export interface RetryOptions {
  fetch?: Fetcher;
  sleep?: Sleep;
  /** Total attempts including the first (default `R2_MAX_ATTEMPTS`). */
  maxAttempts?: number;
  /** Wait before retry n is `n × backoffMs` (default `R2_RETRY_BACKOFF_MS`). */
  backoffMs?: number;
}

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends the request built by `build` (called once per attempt, so signatures stay fresh) and
 * retries network errors and transient statuses with linear backoff. After the last attempt a
 * transient response is returned for the caller to report; a network error is thrown.
 */
export async function fetchWithRetry(
  operation: string,
  build: () => Promise<Request>,
  options: RetryOptions = {},
): Promise<Response> {
  const fetcher = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? R2_MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? R2_RETRY_BACKOFF_MS;

  for (let attempt = 1; ; attempt++) {
    const last = attempt >= maxAttempts;
    let res: Response;
    try {
      res = await fetcher(await build());
    } catch (err) {
      if (last) {
        throw new StorageError(`${operation} failed after ${attempt} attempts: ${String(err)}`, {
          cause: err,
        });
      }
      await sleep(attempt * backoffMs);
      continue;
    }
    if (last || !TRANSIENT_STATUSES.has(res.status)) return res;
    await res.body?.cancel();
    await sleep(attempt * backoffMs);
  }
}
