import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '@vrt/engine/diff';
import {
  PROJECT_DEFAULTS,
  apiErrorResponse,
  diffResponse,
  sha256Hex,
  type DiffRequest,
} from '@vrt/shared';
import { FakeObjectStore } from '@vrt/storage/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pngDimensions } from './diff.ts';
import { createDiffServer } from './server.ts';

interface GoldenDiff {
  name: string;
  a: string;
  b: string;
  diffPixels: number;
  totalPixels: number;
  pct: number;
}

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
const fixture = (...parts: string[]) =>
  new Uint8Array(fs.readFileSync(path.join(FIXTURES, ...parts)));
const golden = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, 'golden', 'png-diffs.json'), 'utf8'),
) as GoldenDiff[];

const SECRET = 'test-diff-container-shared-secret-0123456789';
const BUCKET = 'vrt-test';

const errorOf = async (res: Response) => apiErrorResponse.parse(await res.json()).error;

/** A PNG signature and IHDR chunk claiming `width × height`; enough for the size guard. */
function pngHeader(width: number, height: number): Uint8Array {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf.set([8, 6, 0, 0, 0], 24);
  return new Uint8Array(buf);
}

describe('diff-container server', () => {
  const store = new FakeObjectStore();
  const server = createDiffServer({
    store,
    sharedSecret: SECRET,
    onError: () => {},
  });
  let baseUrl = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  beforeEach(() => {
    store.buckets.clear();
    vi.restoreAllMocks();
  });

  async function seed(before: Uint8Array, after: Uint8Array) {
    await store.put(BUCKET, 'screenshots/a/desktop/page.png', before, 'image/png');
    await store.put(BUCKET, 'screenshots/b/desktop/page.png', after, 'image/png');
  }

  function request(overrides: Partial<DiffRequest> = {}): DiffRequest {
    return {
      bucket: BUCKET,
      beforeKey: 'screenshots/a/desktop/page.png',
      afterKey: 'screenshots/b/desktop/page.png',
      diffKey: 'diffs/a_vs_b/desktop/page.png',
      threshold: PROJECT_DEFAULTS.diffThreshold,
      changeThresholdPct: PROJECT_DEFAULTS.changeThresholdPct,
      regions: [],
      ...overrides,
    };
  }

  function postDiff(body: unknown, authorization: string | null = `Bearer ${SECRET}`) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (authorization !== null) headers.authorization = authorization;
    return fetch(`${baseUrl}/diff`, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  it('GET /health answers without auth', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('answers 404 for unknown routes and 405 for the wrong method', async () => {
    expect((await fetch(`${baseUrl}/nope`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/diff`)).status).toBe(405);
  });

  describe('POST /diff golden parity', () => {
    it.each(golden)('$name: same pixel counts as the engine golden tests', async (g) => {
      const before = fixture('png', g.a);
      const after = fixture('png', g.b);
      await seed(before, after);

      const res = await postDiff(request());
      expect(res.status).toBe(200);
      const body = diffResponse.parse(await res.json());
      expect(body.diffPixels).toBe(g.diffPixels);
      expect(body.totalPixels).toBe(g.totalPixels);
      expect(body.diffPct).toBe(g.pct);
      expect(body.changed).toBe(g.pct >= PROJECT_DEFAULTS.changeThresholdPct);
      expect(body.beforeDims).toEqual(pngDimensions(before));
      expect(body.afterDims).toEqual(pngDimensions(after));
      expect(body.afterSha256).toBe(await sha256Hex(after));

      const diff = await store.head(BUCKET, 'diffs/a_vs_b/desktop/page.png');
      if (body.changed) {
        expect(diff?.contentType).toBe('image/png');
      } else {
        expect(diff).toBeNull();
      }
    });
  });

  it('uploads the diff PNG at diffKey when changed', async () => {
    await seed(fixture('png', 'block-change-a.png'), fixture('png', 'block-change-b.png'));
    const body = diffResponse.parse(await (await postDiff(request())).json());
    expect(body.changed).toBe(true);
    const png = decodePng(await store.get(BUCKET, 'diffs/a_vs_b/desktop/page.png'));
    expect([png.width, png.height]).toEqual(pngDimensions(fixture('png', 'block-change-a.png')));
  });

  it('does not upload a diff PNG when unchanged', async () => {
    // 1 of 3072 pixels differs: 0.033 % is below the default 0.05 % change threshold.
    await seed(fixture('png', 'one-pixel-a.png'), fixture('png', 'one-pixel-b.png'));
    const body = diffResponse.parse(await (await postDiff(request())).json());
    expect(body).toMatchObject({ changed: false, diffPixels: 1 });
    expect(await store.head(BUCKET, 'diffs/a_vs_b/desktop/page.png')).toBeNull();
  });

  it('honours thresholds from the request', async () => {
    await seed(fixture('png', 'one-pixel-a.png'), fixture('png', 'one-pixel-b.png'));
    const body = diffResponse.parse(
      await (await postDiff(request({ changeThresholdPct: 0.01 }))).json(),
    );
    expect(body.changed).toBe(true);
    expect(await store.head(BUCKET, 'diffs/a_vs_b/desktop/page.png')).not.toBeNull();
  });

  it('masks regions in both images before diffing', async () => {
    await seed(fixture('png', 'block-change-a.png'), fixture('png', 'block-change-b.png'));
    const [width, height] = pngDimensions(fixture('png', 'block-change-a.png'))!;
    const body = diffResponse.parse(
      await (await postDiff(request({ regions: [{ x: 0, y: 0, width, height }] }))).json(),
    );
    expect(body).toMatchObject({ changed: false, diffPixels: 0 });
  });

  it.each([
    ['no Authorization header', null],
    ['a wrong token', 'Bearer not-the-secret'],
    ['a non-bearer scheme', `Basic ${SECRET}`],
  ])('rejects %s with 401', async (_name, authorization) => {
    await seed(fixture('png', 'block-change-a.png'), fixture('png', 'block-change-b.png'));
    const res = await postDiff(request(), authorization);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: 'unauthorized', message: 'Missing or invalid bearer token' },
    });
    expect(await store.head(BUCKET, 'diffs/a_vs_b/desktop/page.png')).toBeNull();
  });

  it('rejects invalid bodies with 400', async () => {
    expect((await postDiff('{not json')).status).toBe(400);
    const res = await postDiff({ ...request(), threshold: 2 });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('validation_error');
  });

  it('answers 404 when an image is missing', async () => {
    const res = await postDiff(request());
    expect(res.status).toBe(404);
    expect((await errorOf(res)).message).toMatch(/before image not found/);
  });

  it('rejects images taller than maxPageHeight', async () => {
    await seed(pngHeader(1280, 900), pngHeader(1280, 20_000));
    const res = await postDiff(request());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: {
        code: 'business_rule',
        message: 'after image is 1280×20000 px, taller than max_page_height 16384',
        details: { reason: 'image_too_large', image: 'after', width: 1280, height: 20_000 },
      },
    });

    await seed(pngHeader(1280, 2_000), pngHeader(1280, 900));
    const lower = await postDiff(request({ maxPageHeight: 1_000 }));
    expect(lower.status).toBe(422);
    expect((await errorOf(lower)).details).toMatchObject({ image: 'before', height: 2_000 });
  });

  it('rejects pairs larger than 64 MP', async () => {
    await seed(pngHeader(8_000, 900), pngHeader(1280, 8_001));
    const res = await postDiff(request({ maxPageHeight: 32_768 }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: {
        code: 'business_rule',
        message: 'Diff area 8000×8001 px exceeds the 64 MP limit',
        details: { reason: 'image_too_large', width: 8_000, height: 8_001 },
      },
    });
  });

  it('rejects objects that are not PNGs', async () => {
    await seed(new TextEncoder().encode('not a png at all, just some text'), pngHeader(10, 10));
    const res = await postDiff(request());
    expect(res.status).toBe(422);
    expect((await errorOf(res)).message).toMatch(/before image is not a PNG/);
  });

  it('answers 500 when storage fails', async () => {
    await seed(fixture('png', 'block-change-a.png'), fixture('png', 'block-change-b.png'));
    vi.spyOn(store, 'put').mockRejectedValueOnce(new Error('R2 put failed: 503'));
    const res = await postDiff(request());
    expect(res.status).toBe(500);
    expect(await errorOf(res)).toEqual({
      code: 'internal_error',
      message: 'Diff failed: R2 put failed: 503',
    });
  });
});
