import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';

/**
 * Proves the package runs without Node APIs: bundle it for a neutral platform and execute it in
 * workerd (the Workers runtime) with Node globals disabled. Fetch is stubbed, so this exercises
 * signing, XML parsing and retries inside the runtime without network access.
 */

const entry = `
import { R2ObjectStore, CloudflareBucketAdmin } from './index';
import { FakeObjectStore } from './testing';

export default {
  async fetch() {
    const seen = [];
    let calls = 0;
    const stub = async (req) => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.get('authorization') ?? '' });
      calls++;
      if (calls === 1) return new Response('busy', { status: 503 });
      if (req.method === 'GET' && new URL(req.url).searchParams.get('list-type') === '2') {
        return new Response('<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>a&amp;b</Key><Size>7</Size></Contents></ListBucketResult>');
      }
      if (req.url.endsWith('/r2/buckets/vrt')) return Response.json({ success: true, result: { name: 'vrt' } });
      return new Response(new Uint8Array([9, 8]));
    };
    const opts = { fetch: stub, sleep: async () => {} };
    const store = new R2ObjectStore({ accountId: 'acc', accessKeyId: 'id', secretAccessKey: 'secret', ...opts });
    const listed = [];
    for await (const e of store.list('vrt', '')) listed.push(e);
    const bytes = Array.from(await store.get('vrt', 'k'));
    const presigned = new URL(await store.presignGet('vrt', 'k')).searchParams.has('X-Amz-Signature');
    const exists = await new CloudflareBucketAdmin({ accountId: 'acc', apiToken: 't', ...opts }).exists('vrt');

    const fake = new FakeObjectStore();
    await fake.put('b', 'k', new Uint8Array([1]), 'x');

    return Response.json({
      listed,
      bytes,
      presigned,
      exists,
      signed: seen.slice(0, 3).every((s) => s.auth.startsWith('AWS4-HMAC-SHA256 ')),
      attempts: seen.length,
      fake: Array.from(await fake.get('b', 'k')),
    });
  },
};
`;

describe('runtime compatibility', () => {
  it('runs in workerd without Node APIs', { timeout: 60_000 }, async () => {
    const result = await build({
      stdin: {
        contents: entry,
        resolveDir: fileURLToPath(new URL('.', import.meta.url)),
        loader: 'ts',
      },
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      mainFields: ['module', 'main'],
      write: false,
      logLevel: 'silent',
    });
    const script = result.outputFiles[0]!.text;
    expect(script).not.toMatch(/from\s*["']node:/);

    const mf = new Miniflare({
      workers: [
        {
          config: {
            name: 'storage',
            compatibilityDate: '2026-11-01',
            // recent compatibility dates expose Buffer/process by default; Next.js edge does not
            compatibilityFlags: ['no_nodejs_compat_v2'],
            manifest: {
              mainModule: 'index.js',
              modules: { 'index.js': { type: 'esm', contents: script } },
            },
          },
        },
      ],
    });
    try {
      const response = await mf.dispatchFetch('http://localhost/');
      expect(await response.json()).toEqual({
        listed: [{ key: 'a&b', size: 7 }],
        bytes: [9, 8],
        presigned: true,
        exists: true,
        signed: true,
        attempts: 4,
        fake: [1],
      });
    } finally {
      await mf.dispose();
    }
  });
});
