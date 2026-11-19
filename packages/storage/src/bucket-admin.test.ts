import { describe, expect, it } from 'vitest';
import { CloudflareBucketAdmin } from './bucket-admin';
import { StorageError } from './errors';
import { mockFetch, noSleep, type MockFetch } from './test-helpers';

const BASE = 'https://api.cloudflare.com/client/v4/accounts/acc123/r2/buckets';

function admin(mock: MockFetch) {
  return new CloudflareBucketAdmin({
    accountId: 'acc123',
    apiToken: 'cf-token',
    fetch: mock.fetch,
    sleep: noSleep,
  });
}

const ok = (result: unknown, resultInfo?: unknown) =>
  Response.json({ success: true, errors: [], result, result_info: resultInfo });

describe('CloudflareBucketAdmin', () => {
  it('exists: true on 200, false on 404, with bearer auth', async () => {
    const mock = mockFetch((_req, i) =>
      i === 0 ? ok({ name: 'a' }) : new Response('', { status: 404 }),
    );
    const a = admin(mock);

    expect(await a.exists('a')).toBe(true);
    expect(await a.exists('missing')).toBe(false);
    expect(mock.requests[0]!.url).toBe(`${BASE}/a`);
    expect(mock.requests[0]!.headers.get('authorization')).toBe('Bearer cf-token');
  });

  it('exists: throws on other errors', async () => {
    const mock = mockFetch(() => new Response('', { status: 403 }));

    await expect(admin(mock).exists('a')).rejects.toBeInstanceOf(StorageError);
  });

  it('ensure: does nothing when the bucket exists', async () => {
    const mock = mockFetch(() => ok({ name: 'a' }));

    expect(await admin(mock).ensure('a')).toEqual({ created: false });
    expect(mock.requests).toHaveLength(1);
  });

  it('ensure: creates a missing bucket', async () => {
    const mock = mockFetch((_req, i) =>
      i === 0 ? new Response('', { status: 404 }) : ok({ name: 'new' }),
    );

    expect(await admin(mock).ensure('new')).toEqual({ created: true });
    const create = mock.requests[1]!;
    expect(create.method).toBe('POST');
    expect(create.url).toBe(BASE);
    expect(create.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(mock.bodies[1]!)).toEqual({ name: 'new' });
  });

  it('ensure: tolerates 409 from a concurrent create', async () => {
    const mock = mockFetch((_req, i) =>
      i === 0 ? new Response('', { status: 404 }) : new Response('{}', { status: 409 }),
    );

    expect(await admin(mock).ensure('race')).toEqual({ created: false });
  });

  it('ensure: throws on other create errors', async () => {
    const mock = mockFetch((_req, i) =>
      i === 0 ? new Response('', { status: 404 }) : new Response('bad name', { status: 400 }),
    );

    await expect(admin(mock).ensure('Bad_Name')).rejects.toMatchObject({ status: 400 });
  });

  it('list: follows cursors and maps fields', async () => {
    const mock = mockFetch((_req, i) =>
      i === 0
        ? ok(
            { buckets: [{ name: 'a', creation_date: '2026-01-01T00:00:00Z', location: 'WEUR' }] },
            { cursor: 'c1' },
          )
        : ok({ buckets: [{ name: 'b' }] }, {}),
    );

    expect(await admin(mock).list()).toEqual([
      { name: 'a', creationDate: '2026-01-01T00:00:00Z', location: 'WEUR' },
      { name: 'b', creationDate: null, location: null },
    ]);
    expect(new URL(mock.requests[0]!.url).searchParams.has('cursor')).toBe(false);
    expect(new URL(mock.requests[1]!.url).searchParams.get('cursor')).toBe('c1');
  });

  it('list: throws when the API reports failure', async () => {
    const mock = mockFetch(() =>
      Response.json({ success: false, errors: [{ code: 10000, message: 'auth' }], result: null }),
    );

    await expect(admin(mock).list()).rejects.toThrow(/auth/);
  });

  it('retries transient errors', async () => {
    const mock = mockFetch((_req, i) =>
      i < 2 ? new Response('', { status: 522 }) : ok({ name: 'a' }),
    );

    expect(await admin(mock).exists('a')).toBe(true);
    expect(mock.requests).toHaveLength(3);
  });
});
