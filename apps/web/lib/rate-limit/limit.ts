import { RequestError } from '../members/errors';

/**
 * Records one request in `bucket` and returns 0, or the seconds until the next request is allowed
 * when the window is full (RPC `consume_rate_limit`).
 */
export type ConsumeRateLimit = (
  bucket: string,
  limit: number,
  windowSeconds: number,
) => Promise<number>;

export interface RateLimit {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

/** 429 `rate_limited` with `Retry-After` (NFR-17). */
export class RateLimitedError extends RequestError {
  constructor(readonly retryAfterSeconds: number) {
    super(429, 'rate_limited', 'Too many requests. Try again in a minute.', {
      retryAfterSeconds,
    });
    this.name = 'RateLimitedError';
  }
}

/** Throws `RateLimitedError` when the caller already used up `rate` in the current window. */
export async function enforceRateLimit(consume: ConsumeRateLimit, rate: RateLimit) {
  const retryAfterSeconds = await consume(rate.bucket, rate.limit, rate.windowSeconds);
  if (retryAfterSeconds > 0) throw new RateLimitedError(retryAfterSeconds);
}
