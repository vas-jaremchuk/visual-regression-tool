import { describe, expect, it } from 'vitest';
import { fetchDlqCounts } from './dlq';

const BASE = 'https://api.cloudflare.com/client/v4/accounts/acct/queues';

function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get('Authorization') });
    const route = routes[url];
    if (!route) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const LIST = {
  [`${BASE}?per_page=100&page=1`]: {
    body: {
      success: true,
      result: [
        { queue_id: 'q1', queue_name: 'vrt-capture' },
        { queue_id: 'q2', queue_name: 'vrt-capture-dlq' },
        { queue_id: 'q3', queue_name: 'vrt-diff-dlq' },
      ],
      result_info: { total_pages: 1 },
    },
  },
};

describe('fetchDlqCounts', () => {
  it('reads the backlog of each dead letter queue', async () => {
    const { fetch, calls } = fakeFetch({
      ...LIST,
      [`${BASE}/q2/metrics`]: {
        body: {
          success: true,
          result: { backlog_count: 3, oldest_message_timestamp_ms: 1763812800000 },
        },
      },
      [`${BASE}/q3/metrics`]: { body: { success: true, result: { backlog_count: 0 } } },
    });
    const counts = await fetchDlqCounts({ accountId: 'acct', apiToken: 'tok', fetch });
    expect(counts).toEqual([
      {
        queue: 'vrt-capture-dlq',
        messages: 3,
        oldestMessageAt: new Date(1763812800000).toISOString(),
      },
      { queue: 'vrt-diff-dlq', messages: 0, oldestMessageAt: null },
    ]);
    expect(calls.every((c) => c.auth === 'Bearer tok')).toBe(true);
  });

  it('reports a missing queue and a failed metrics call per queue', async () => {
    const { fetch } = fakeFetch({
      [`${BASE}?per_page=100&page=1`]: {
        body: { success: true, result: [{ queue_id: 'q2', queue_name: 'vrt-capture-dlq' }] },
      },
      [`${BASE}/q2/metrics`]: {
        status: 403,
        body: { success: false, result: null, errors: [{ message: 'Authentication error' }] },
      },
    });
    const counts = await fetchDlqCounts({ accountId: 'acct', apiToken: 'tok', fetch });
    expect(counts).toEqual([
      {
        queue: 'vrt-capture-dlq',
        messages: null,
        oldestMessageAt: null,
        error: 'Cloudflare API 403: Authentication error',
      },
      { queue: 'vrt-diff-dlq', messages: null, oldestMessageAt: null, error: 'Queue not found' },
    ]);
  });

  it('reports every queue as unreadable when listing fails', async () => {
    const { fetch } = fakeFetch({});
    const counts = await fetchDlqCounts({ accountId: 'acct', apiToken: 'tok', fetch });
    expect(counts.map((c) => [c.queue, c.messages, c.error?.startsWith('Could not list')])).toEqual(
      [
        ['vrt-capture-dlq', null, true],
        ['vrt-diff-dlq', null, true],
      ],
    );
  });
});
