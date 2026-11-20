import { PROBE_KEY } from '@vrt/shared';
import { FakeObjectStore } from '@vrt/storage/testing';
import { describe, expect, it } from 'vitest';
import { checkBucket, publicObjectUrl, type BucketExistence } from './bucket-check';

class FakeBuckets implements BucketExistence {
  constructor(readonly names: Set<string>) {}
  async exists(name: string) {
    return this.names.has(name);
  }
  async ensure(name: string) {
    const created = !this.names.has(name);
    this.names.add(name);
    return { created };
  }
}

const project = { r2Bucket: 'site-vrt', r2PublicUrl: 'https://pub-123.r2.dev/' };

/** Serves the store's objects like an R2 public development URL. */
function publicFetch(store: FakeObjectStore, bucket: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const key = new URL(String(input)).pathname.slice(1);
    try {
      return new Response(await store.get(bucket, key));
    } catch {
      return new Response('not found', { status: 404 });
    }
  }) as typeof fetch;
}

describe('checkBucket', () => {
  it('writes, reads and deletes a probe and fetches it via the public URL', async () => {
    const store = new FakeObjectStore();
    const result = await checkBucket(
      {
        buckets: new FakeBuckets(new Set(['site-vrt'])),
        store,
        fetch: publicFetch(store, 'site-vrt'),
      },
      project,
      { create: false },
    );
    expect(result).toEqual({
      exists: true,
      created: false,
      canReadWriteDelete: true,
      publicUrl: 'ok',
    });
    expect(await store.head('site-vrt', PROBE_KEY)).toBeNull();
  });

  it('reports a missing bucket and creates it on request', async () => {
    const buckets = new FakeBuckets(new Set());
    const store = new FakeObjectStore();
    const deps = { buckets, store, fetch: publicFetch(store, 'site-vrt') };
    const missing = await checkBucket(deps, { ...project, r2PublicUrl: null }, { create: false });
    expect(missing).toMatchObject({
      exists: false,
      created: false,
      canReadWriteDelete: false,
      publicUrl: 'not_configured',
      error: 'Bucket site-vrt does not exist',
    });
    const created = await checkBucket(deps, { ...project, r2PublicUrl: null }, { create: true });
    expect(created).toEqual({
      exists: true,
      created: true,
      canReadWriteDelete: true,
      publicUrl: 'not_configured',
    });
  });

  it('flags a public URL that does not serve the probe', async () => {
    const store = new FakeObjectStore();
    const result = await checkBucket(
      {
        buckets: new FakeBuckets(new Set(['site-vrt'])),
        store,
        fetch: (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch,
      },
      project,
      { create: false },
    );
    expect(result).toMatchObject({ canReadWriteDelete: true, publicUrl: 'failed' });
  });

  it('reports write failures', async () => {
    const store = new FakeObjectStore();
    store.put = async () => {
      throw new Error('403 AccessDenied');
    };
    const result = await checkBucket(
      { buckets: new FakeBuckets(new Set(['site-vrt'])), store, fetch },
      project,
      { create: false },
    );
    expect(result).toMatchObject({
      exists: true,
      canReadWriteDelete: false,
      error: 'Could not write the probe object: 403 AccessDenied',
    });
  });
});

describe('publicObjectUrl', () => {
  it('joins with a single slash', () => {
    expect(publicObjectUrl('https://pub.r2.dev//', PROBE_KEY)).toBe(
      `https://pub.r2.dev/${PROBE_KEY}`,
    );
  });
});
