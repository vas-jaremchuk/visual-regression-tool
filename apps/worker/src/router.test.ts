import { signRequest, toBase64 } from '@vrt/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './env';
import { handleRequest } from './router';

const secret = 's'.repeat(32);
const ORIGIN = 'https://worker.test';

function makeEnv(overrides: Record<string, unknown> = {}): Env {
  return {
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    CF_ACCOUNT_ID: 'acct',
    CF_API_TOKEN: 'token',
    R2_ACCESS_KEY_ID: 'id',
    R2_SECRET_ACCESS_KEY: 'key',
    WORKER_SHARED_SECRET: secret,
    SETTINGS_ENCRYPTION_KEY: toBase64(new Uint8Array(32).fill(1)),
    RESEND_API_KEY: 're_123',
    EMAIL_FROM: 'vrt@example.com',
    APP_URL: 'http://localhost:3000',
    DIFF_CONTAINER_SHARED_SECRET: 'd'.repeat(32),
    ...overrides,
  } as unknown as Env;
}

async function signed(method: string, path: string, body?: unknown, key = secret) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const authorization = await signRequest({ secret: key, method, path, body: text });
  return new Request(ORIGIN + path, {
    method,
    body: text,
    headers: { authorization, 'content-type': 'application/json' },
  });
}

const uuid = '6f1c9a52-5d1b-4c8e-9a9e-3b1f2c4d5e6f';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('GET /health', () => {
  it('answers unsigned with ok and version', async () => {
    const res = await handleRequest(new Request(`${ORIGIN}/health`), makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: 'dev' });
  });

  it('reports the deployed version id', async () => {
    const env = makeEnv({ CF_VERSION_METADATA: { id: 'v-123', tag: '', timestamp: '' } });
    const res = await handleRequest(new Request(`${ORIGIN}/health`), env);
    expect(await res.json()).toEqual({ ok: true, version: 'v-123' });
  });
});

describe('HMAC middleware on /jobs/*', () => {
  it('rejects a request without a signature', async () => {
    const req = new Request(`${ORIGIN}/jobs/capture`, {
      method: 'POST',
      body: JSON.stringify({ runId: uuid }),
    });
    const res = await handleRequest(req, makeEnv());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('rejects a signature made with another secret', async () => {
    const req = await signed('POST', '/jobs/capture', { runId: uuid }, 'x'.repeat(32));
    expect((await handleRequest(req, makeEnv())).status).toBe(401);
  });

  it('rejects a signature over a different body', async () => {
    const good = await signed('POST', '/jobs/capture', { runId: uuid });
    const req = new Request(good.url, {
      method: 'POST',
      headers: good.headers,
      body: JSON.stringify({ runId: '00000000-0000-4000-8000-000000000000' }),
    });
    expect((await handleRequest(req, makeEnv())).status).toBe(401);
  });

  it('rejects a signature for a different path', async () => {
    const good = await signed('POST', '/jobs/sitemap', { runId: uuid });
    const req = new Request(`${ORIGIN}/jobs/capture`, {
      method: 'POST',
      headers: good.headers,
      body: JSON.stringify({ runId: uuid }),
    });
    expect((await handleRequest(req, makeEnv())).status).toBe(401);
  });

  it('rejects a malformed header and a stale timestamp', async () => {
    const malformed = new Request(`${ORIGIN}/jobs/${uuid}`, {
      headers: { authorization: 'Bearer nope' },
    });
    expect((await handleRequest(malformed, makeEnv())).status).toBe(401);

    const authorization = await signRequest({
      secret,
      method: 'GET',
      path: `/jobs/${uuid}`,
      now: Date.now() - 6 * 60 * 1000,
    });
    const stale = new Request(`${ORIGIN}/jobs/${uuid}`, { headers: { authorization } });
    expect((await handleRequest(stale, makeEnv())).status).toBe(401);
  });

  it('requires a signature even for unknown job paths', async () => {
    const res = await handleRequest(new Request(`${ORIGIN}/jobs/nope/nope`), makeEnv());
    expect(res.status).toBe(401);
  });
});

describe('POST /jobs/sitemap', () => {
  function workflowBinding() {
    const instances = new Map<string, unknown>();
    return {
      instances,
      create: vi.fn(async ({ id, params }: { id: string; params: unknown }) => {
        if (instances.has(id)) throw new Error(`instance.already_exists: ${id}`);
        instances.set(id, params);
        return { id };
      }),
      get: vi.fn(async (id: string) => ({ id })),
    };
  }

  it('starts a SitemapWorkflow instance named after the snapshot', async () => {
    const binding = workflowBinding();
    const env = makeEnv({ SITEMAP_FETCH: binding });
    const res = await handleRequest(
      await signed('POST', '/jobs/sitemap', { snapshotId: uuid }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workflowId: uuid });
    expect(binding.instances.get(uuid)).toEqual({ snapshotId: uuid });
  });

  it('answers with the existing instance when the snapshot already has one', async () => {
    const binding = workflowBinding();
    const env = makeEnv({ SITEMAP_FETCH: binding });
    await handleRequest(await signed('POST', '/jobs/sitemap', { snapshotId: uuid }), env);
    const res = await handleRequest(
      await signed('POST', '/jobs/sitemap', { snapshotId: uuid }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workflowId: uuid });
    expect(binding.create).toHaveBeenCalledTimes(2);
  });

  it('rejects a body without a snapshot id', async () => {
    const env = makeEnv({ SITEMAP_FETCH: workflowBinding() });
    const res = await handleRequest(await signed('POST', '/jobs/sitemap', { runId: uuid }), env);
    expect(res.status).toBe(400);
  });
});

describe('POST /jobs/capture', () => {
  function workflowBinding(status = 'running') {
    const instances = new Map<string, unknown>();
    return {
      instances,
      create: vi.fn(async ({ id, params }: { id: string; params: unknown }) => {
        if (instances.has(id)) throw new Error(`instance.already_exists: ${id}`);
        instances.set(id, params);
        return { id };
      }),
      get: vi.fn(async (id: string) => ({ id, status: async () => ({ status }) })),
    };
  }

  it('starts a CaptureRunWorkflow instance named after the run', async () => {
    const binding = workflowBinding();
    const env = makeEnv({ CAPTURE_RUN: binding });
    const res = await handleRequest(await signed('POST', '/jobs/capture', { runId: uuid }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workflowId: uuid });
    expect(binding.instances.get(uuid)).toEqual({ runId: uuid });
  });

  it('answers with the live instance instead of starting a second one', async () => {
    const binding = workflowBinding('waiting');
    const env = makeEnv({ CAPTURE_RUN: binding });
    await handleRequest(await signed('POST', '/jobs/capture', { runId: uuid }), env);
    const res = await handleRequest(await signed('POST', '/jobs/capture', { runId: uuid }), env);
    expect(await res.json()).toEqual({ workflowId: uuid });
    expect(binding.instances.size).toBe(1);
  });

  it('starts a new instance for the same run once the first has ended (retry failed)', async () => {
    const binding = workflowBinding('complete');
    const env = makeEnv({ CAPTURE_RUN: binding });
    await handleRequest(await signed('POST', '/jobs/capture', { runId: uuid }), env);
    const res = await handleRequest(await signed('POST', '/jobs/capture', { runId: uuid }), env);
    const { workflowId } = (await res.json()) as { workflowId: string };
    expect(workflowId).toMatch(new RegExp(`^${uuid}-[a-z0-9]+$`));
    expect(binding.instances.get(workflowId)).toEqual({ runId: uuid });
  });

  it('rejects a cancel for a run id that is not a UUID', async () => {
    const res = await handleRequest(await signed('POST', '/jobs/capture/nope/cancel'), makeEnv());
    expect(res.status).toBe(400);
  });
});

describe('signed job stubs', () => {
  it.each([
    ['/jobs/compare', { comparisonId: uuid }],
    ['/jobs/delete', { entity: 'run', id: uuid }],
    ['/jobs/import-legacy', { projectId: uuid, labels: ['2026-08-07_10-00-00'] }],
    ['/jobs/storage', { projectId: uuid }],
  ])('POST %s answers 200 with a workflow id', async (path, body) => {
    const res = await handleRequest(await signed('POST', path, body), makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { workflowId: string };
    expect(json.workflowId).toMatch(/^stub-/);
  });

  it('GET /jobs/:workflowId answers 200 with a status', async () => {
    const res = await handleRequest(await signed('GET', '/jobs/stub-abc'), makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'unknown', workflowId: 'stub-abc' });
  });

  it('rejects an invalid body with 400', async () => {
    const res = await handleRequest(
      await signed('POST', '/jobs/capture', { runId: 'x' }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'validation_error' } });
  });

  it('answers 404 for an unknown signed path', async () => {
    const res = await handleRequest(await signed('POST', '/jobs/unknown', {}), makeEnv());
    expect(res.status).toBe(404);
  });
});

describe('env validation', () => {
  it('answers 500 and logs the variable names when the env is invalid', async () => {
    const env = makeEnv({ WORKER_SHARED_SECRET: 'short', SUPABASE_URL: undefined });
    const res = await handleRequest(new Request(`${ORIGIN}/health`), env);
    expect(res.status).toBe(500);
    const logged = vi
      .mocked(console.error)
      .mock.calls.map((c) => String(c[0]))
      .join('\n');
    expect(logged).toContain('WORKER_SHARED_SECRET');
    expect(logged).toContain('SUPABASE_URL');
    expect(await res.text()).not.toContain('short');
  });
});
