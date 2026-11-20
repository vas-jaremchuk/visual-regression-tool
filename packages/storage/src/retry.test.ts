import { describe, expect, it, vi } from 'vitest';
import { StorageError } from './errors';
import { TRANSIENT_STATUSES, fetchWithRetry } from './retry';
import { mockFetch } from './test-helpers';

const build = async () => new Request('https://r2.test/b/k');

describe('fetchWithRetry (NFR-9)', () => {
  it('retries transient statuses with attempt × 2 s backoff and returns the success', async () => {
    const statuses = [503, 429, 520, 200];
    const { fetch, requests } = mockFetch((_req, i) => new Response('x', { status: statuses[i] }));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    const res = await fetchWithRetry('op', build, { fetch, sleep });

    expect(res.status).toBe(200);
    expect(requests).toHaveLength(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 4000, 6000]);
  });

  it('retries network errors', async () => {
    const { fetch, requests } = mockFetch((_req, i) => {
      if (i < 2) throw new TypeError('fetch failed');
      return new Response(null, { status: 204 });
    });
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    const res = await fetchWithRetry('op', build, { fetch, sleep });

    expect(res.status).toBe(204);
    expect(requests).toHaveLength(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 4000]);
  });

  it('gives up after 5 attempts and returns the last transient response', async () => {
    const { fetch, requests } = mockFetch(() => new Response('busy', { status: 502 }));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    const res = await fetchWithRetry('op', build, { fetch, sleep });

    expect(res.status).toBe(502);
    expect(requests).toHaveLength(5);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 4000, 6000, 8000]);
  });

  it('throws a StorageError after 5 network failures', async () => {
    const { fetch, requests } = mockFetch(() => {
      throw new TypeError('connection reset');
    });

    const err = await fetchWithRetry('R2 put b/k', build, {
      fetch,
      sleep: async () => {},
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).message).toMatch(/R2 put b\/k failed after 5 attempts/);
    expect(requests).toHaveLength(5);
  });

  it('does not retry non-transient statuses', async () => {
    const { fetch, requests } = mockFetch(() => new Response('nope', { status: 403 }));

    const res = await fetchWithRetry('op', build, { fetch, sleep: async () => {} });

    expect(res.status).toBe(403);
    expect(requests).toHaveLength(1);
  });

  it('builds a fresh request per attempt', async () => {
    const { fetch } = mockFetch((_req, i) => new Response(null, { status: i === 0 ? 500 : 200 }));
    const builder = vi.fn(build);

    await fetchWithRetry('op', builder, { fetch, sleep: async () => {} });

    expect(builder).toHaveBeenCalledTimes(2);
  });

  it('treats the statuses listed in NFR-9 as transient', () => {
    for (const status of [429, 500, 502, 503, 504, 520, 521, 522, 523, 524]) {
      expect(TRANSIENT_STATUSES.has(status)).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 409, 501]) {
      expect(TRANSIENT_STATUSES.has(status)).toBe(false);
    }
  });
});
