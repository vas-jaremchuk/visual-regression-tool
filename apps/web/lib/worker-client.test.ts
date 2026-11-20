import { verifyRequest } from '@vrt/shared';
import { describe, expect, it } from 'vitest';
import { WorkerRequestError, createWorkerClient } from './worker-client';

const secret = 's'.repeat(32);
const uuid = '6f1c9a52-5d1b-4c8e-9a9e-3b1f2c4d5e6f';

/** Fake worker that verifies signatures exactly like the real one. */
function fakeWorker(respond: (path: string) => Response) {
  const calls: { url: string; method: string; body?: string; verified: boolean }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body as string | undefined;
    const header = new Headers(init?.headers).get('authorization');
    const result = await verifyRequest({
      secret,
      method,
      path: url.pathname + url.search,
      body,
      header,
    });
    calls.push({ url: url.toString(), method, body, verified: result.ok });
    return respond(url.pathname);
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe('createWorkerClient', () => {
  it('signs job requests so the worker accepts them', async () => {
    const { calls, fetchFn } = fakeWorker(() => Response.json({ workflowId: 'wf-1' }));
    const client = createWorkerClient({ baseUrl: 'https://worker.test/', secret, fetch: fetchFn });

    await expect(client.startCapture({ runId: uuid })).resolves.toEqual({ workflowId: 'wf-1' });
    expect(calls).toEqual([
      {
        url: 'https://worker.test/jobs/capture',
        method: 'POST',
        body: JSON.stringify({ runId: uuid }),
        verified: true,
      },
    ]);
  });

  it('signs bodiless requests', async () => {
    const { calls, fetchFn } = fakeWorker((path) =>
      path.endsWith('/cancel')
        ? new Response(null, { status: 202 })
        : Response.json({ status: 'running' }),
    );
    const client = createWorkerClient({ baseUrl: 'https://worker.test', secret, fetch: fetchFn });

    await client.cancelCapture(uuid);
    await expect(client.getJobStatus('wf-1')).resolves.toEqual({ status: 'running' });
    expect(calls.map((c) => [c.method, new URL(c.url).pathname, c.verified])).toEqual([
      ['POST', `/jobs/capture/${uuid}/cancel`, true],
      ['GET', '/jobs/wf-1', true],
    ]);
  });

  it('calls /health unsigned', async () => {
    const { calls, fetchFn } = fakeWorker(() => Response.json({ ok: true, version: 'v1' }));
    const client = createWorkerClient({ baseUrl: 'https://worker.test', secret, fetch: fetchFn });

    await expect(client.health()).resolves.toEqual({ ok: true, version: 'v1' });
    expect(calls[0]?.verified).toBe(false);
  });

  it('throws WorkerRequestError with the status on a non-2xx response', async () => {
    const { fetchFn } = fakeWorker(() => new Response('nope', { status: 401 }));
    const client = createWorkerClient({ baseUrl: 'https://worker.test', secret, fetch: fetchFn });

    const error = await client.startSitemap({ snapshotId: uuid }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorkerRequestError);
    expect((error as WorkerRequestError).status).toBe(401);
  });
});
