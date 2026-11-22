import { describe, expect, it } from 'vitest';
import { errorResponse } from '../http';
import { enforceRateLimit, RateLimitedError, type ConsumeRateLimit } from './limit';

/** In-memory sliding window with the semantics of RPC `consume_rate_limit`. */
function memoryLimiter(now: () => number): ConsumeRateLimit {
  const hits = new Map<string, number[]>();
  return async (bucket, limit, windowSeconds) => {
    const since = now() - windowSeconds * 1000;
    const kept = (hits.get(bucket) ?? []).filter((t) => t > since);
    hits.set(bucket, kept);
    if (kept.length >= limit) return Math.max(1, Math.ceil((kept[0]! - since) / 1000));
    kept.push(now());
    return 0;
  };
}

const JOB_START = { bucket: 'job_start', limit: 10, windowSeconds: 60 };

describe('enforceRateLimit (NFR-17)', () => {
  it('allows 10 job starts per minute and refuses the 11th with 429 and Retry-After', async () => {
    let clock = 0;
    const consume = memoryLimiter(() => clock);
    for (let i = 0; i < 10; i++) {
      clock += 1000;
      await expect(enforceRateLimit(consume, JOB_START)).resolves.toBeUndefined();
    }
    clock += 1000;
    const error = await enforceRateLimit(consume, JOB_START).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);

    const res = errorResponse(error);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('50');
    expect(await res.json()).toEqual({
      error: {
        code: 'rate_limited',
        message: 'Too many requests. Try again in a minute.',
        details: { retryAfterSeconds: 50 },
      },
    });
  });

  it('allows starts again once the oldest one leaves the window', async () => {
    let clock = 0;
    const consume = memoryLimiter(() => clock);
    for (let i = 0; i < 10; i++) await enforceRateLimit(consume, JOB_START);
    await expect(enforceRateLimit(consume, JOB_START)).rejects.toBeInstanceOf(RateLimitedError);
    clock += 60_001;
    await expect(enforceRateLimit(consume, JOB_START)).resolves.toBeUndefined();
  });

  it('passes the bucket, limit and window to the store', async () => {
    const calls: unknown[][] = [];
    await enforceRateLimit(async (...args) => (calls.push(args), 0), JOB_START);
    expect(calls).toEqual([['job_start', 10, 60]]);
  });
});
