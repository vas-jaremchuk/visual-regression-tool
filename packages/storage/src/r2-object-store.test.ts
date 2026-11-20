import { describe, expect, it } from 'vitest';
import { ObjectNotFoundError, StorageError } from './errors';
import { R2ObjectStore } from './r2-object-store';
import { mockFetch, noSleep, type MockFetch } from './test-helpers';

const ACCOUNT = 'acc123';
const ENDPOINT = `https://${ACCOUNT}.r2.cloudflarestorage.com`;

function store(mock: MockFetch) {
  return new R2ObjectStore({
    accountId: ACCOUNT,
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secret',
    fetch: mock.fetch,
    sleep: noSleep,
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

function listXml(opts: { keys?: [string, number][]; prefixes?: string[]; next?: string }): string {
  const contents = (opts.keys ?? [])
    .map(([k, s]) => `<Contents><Key>${k}</Key><Size>${s}</Size><ETag>"x"</ETag></Contents>`)
    .join('');
  const prefixes = (opts.prefixes ?? [])
    .map((p) => `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`)
    .join('');
  const truncated = opts.next
    ? `<IsTruncated>true</IsTruncated><NextContinuationToken>${opts.next}</NextContinuationToken>`
    : '<IsTruncated>false</IsTruncated>';
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>b</Name><Prefix>p/</Prefix>${truncated}${contents}${prefixes}</ListBucketResult>`;
}

describe('R2ObjectStore', () => {
  describe('signing', () => {
    it('signs requests with SigV4 for service s3, region auto', async () => {
      const mock = mockFetch(() => new Response(null, { status: 200 }));
      const body = new TextEncoder().encode('png-bytes');

      await store(mock).put('vrt-bucket', 'screenshots/ts/desktop/index.png', body, 'image/png');

      const [req] = mock.requests;
      expect(req!.method).toBe('PUT');
      expect(req!.url).toBe(`${ENDPOINT}/vrt-bucket/screenshots/ts/desktop/index.png`);
      expect(req!.headers.get('content-type')).toBe('image/png');
      expect(req!.headers.get('x-amz-date')).toMatch(/^\d{8}T\d{6}Z$/);
      // aws4fetch signs S3 requests with an unsigned payload; the body is protected by TLS.
      expect(req!.headers.get('x-amz-content-sha256')).toBe('UNSIGNED-PAYLOAD');
      expect(req!.headers.get('authorization')).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
      );
      expect(mock.bodies[0]).toBe('png-bytes');
    });

    it('re-signs each retry attempt', async () => {
      const mock = mockFetch((_req, i) => new Response(null, { status: i === 0 ? 503 : 200 }));

      await store(mock).put('b', 'k', new Uint8Array([1]), 'application/octet-stream');

      expect(mock.requests).toHaveLength(2);
      for (const req of mock.requests) expect(req.headers.get('authorization')).toMatch(/^AWS4/);
    });

    it('encodes key segments but keeps slashes', async () => {
      const mock = mockFetch(() => new Response(new Uint8Array([1])));

      await store(mock).get('b', 'files/a b/ü#?.png');

      expect(mock.requests[0]!.url).toBe(`${ENDPOINT}/b/files/a%20b/%C3%BC%23%3F.png`);
    });
  });

  describe('get / head', () => {
    it('returns the object bytes', async () => {
      const mock = mockFetch(() => new Response(new Uint8Array([1, 2, 3])));

      expect(await store(mock).get('b', 'k')).toEqual(new Uint8Array([1, 2, 3]));
      expect(mock.requests[0]!.method).toBe('GET');
    });

    it('throws ObjectNotFoundError on 404 without retrying', async () => {
      const mock = mockFetch(() => new Response('<Error/>', { status: 404 }));

      await expect(store(mock).get('b', 'missing')).rejects.toBeInstanceOf(ObjectNotFoundError);
      expect(mock.requests).toHaveLength(1);
    });

    it('throws StorageError with the status after exhausting retries', async () => {
      const mock = mockFetch(() => new Response('down', { status: 500 }));

      const err = await store(mock)
        .get('b', 'k')
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(StorageError);
      expect((err as StorageError).status).toBe(500);
      expect(mock.requests).toHaveLength(5);
    });

    it('head returns size, content type and etag, or null when missing', async () => {
      const mock = mockFetch((_req, i) =>
        i === 0
          ? new Response(null, {
              headers: { 'content-length': '42', 'content-type': 'image/png', etag: '"abc"' },
            })
          : new Response(null, { status: 404 }),
      );
      const s = store(mock);

      expect(await s.head('b', 'k')).toEqual({ size: 42, contentType: 'image/png', etag: '"abc"' });
      expect(await s.head('b', 'missing')).toBeNull();
      expect(mock.requests[0]!.method).toBe('HEAD');
    });
  });

  describe('list', () => {
    it('follows continuation tokens across pages', async () => {
      const pages = [
        listXml({
          keys: [
            ['p/a.png', 1],
            ['p/b.png', 2],
          ],
          next: 'tok/1+=',
        }),
        listXml({ keys: [['p/c&amp;d.png', 3]] }),
      ];
      const mock = mockFetch((_req, i) => new Response(pages[i]));

      const entries = await collect(store(mock).list('b', 'p/', { pageSize: 2 }));

      expect(entries).toEqual([
        { key: 'p/a.png', size: 1 },
        { key: 'p/b.png', size: 2 },
        { key: 'p/c&d.png', size: 3 },
      ]);
      const [first, second] = mock.requests.map((r) => new URL(r.url));
      expect(first!.pathname).toBe('/b');
      expect(first!.searchParams.get('list-type')).toBe('2');
      expect(first!.searchParams.get('prefix')).toBe('p/');
      expect(first!.searchParams.get('max-keys')).toBe('2');
      expect(first!.searchParams.has('continuation-token')).toBe(false);
      expect(second!.searchParams.get('continuation-token')).toBe('tok/1+=');
    });

    it('passes the delimiter and yields only direct objects', async () => {
      const mock = mockFetch(
        () => new Response(listXml({ keys: [['p/top.png', 5]], prefixes: ['p/sub/'] })),
      );

      const entries = await collect(store(mock).list('b', 'p/', { delimiter: '/' }));

      expect(entries).toEqual([{ key: 'p/top.png', size: 5 }]);
      expect(new URL(mock.requests[0]!.url).searchParams.get('delimiter')).toBe('/');
    });

    it('listPrefixes yields common prefixes across pages', async () => {
      const pages = [
        listXml({ prefixes: ['screenshots/2026-01/', 'screenshots/2026-02/'], next: 't' }),
        listXml({ prefixes: ['screenshots/2026-03/'] }),
      ];
      const mock = mockFetch((_req, i) => new Response(pages[i]));

      expect(await collect(store(mock).listPrefixes('b', 'screenshots/'))).toEqual([
        'screenshots/2026-01/',
        'screenshots/2026-02/',
        'screenshots/2026-03/',
      ]);
    });

    it('retries a transient page failure and continues', async () => {
      const responses = [
        () => new Response(listXml({ keys: [['a', 1]], next: 't' })),
        () => new Response('slow down', { status: 429 }),
        () => new Response(listXml({ keys: [['b', 1]] })),
      ];
      const mock = mockFetch((_req, i) => responses[i]!());

      expect((await collect(store(mock).list('b', ''))).map((e) => e.key)).toEqual(['a', 'b']);
      expect(new URL(mock.requests[2]!.url).searchParams.get('continuation-token')).toBe('t');
    });

    it('throws on a non-transient list error', async () => {
      const mock = mockFetch(() => new Response('denied', { status: 403 }));

      await expect(collect(store(mock).list('b', ''))).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('delete', () => {
    it('chunks keys into DeleteObjects batches of at most 1000', async () => {
      const mock = mockFetch(() => new Response('<DeleteResult/>'));
      const keys = Array.from({ length: 2345 }, (_, i) => `k/${i}`);

      await store(mock).delete('b', keys);

      expect(mock.requests).toHaveLength(3);
      const counts = mock.bodies.map((b) => b.match(/<Object>/g)?.length);
      expect(counts).toEqual([1000, 1000, 345]);
      for (const req of mock.requests) {
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${ENDPOINT}/b?delete`);
        expect(req.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /);
      }
      expect(mock.bodies[0]).toContain('<Quiet>true</Quiet><Object><Key>k/0</Key></Object>');
      expect(mock.bodies[2]).toContain('<Key>k/2344</Key>');
    });

    it('escapes keys in the XML body', async () => {
      const mock = mockFetch(() => new Response('<DeleteResult/>'));

      await store(mock).delete('b', ['a&b<c>.png']);

      expect(mock.bodies[0]).toContain('<Key>a&amp;b&lt;c&gt;.png</Key>');
    });

    it('sends nothing for an empty key list', async () => {
      const mock = mockFetch(() => new Response('<DeleteResult/>'));

      await store(mock).delete('b', []);

      expect(mock.requests).toHaveLength(0);
    });

    it('throws when the result reports per-key errors other than NoSuchKey', async () => {
      const mock = mockFetch(
        () =>
          new Response(
            '<DeleteResult><Error><Key>gone</Key><Code>NoSuchKey</Code><Message>x</Message></Error>' +
              '<Error><Key>locked</Key><Code>AccessDenied</Code><Message>no</Message></Error></DeleteResult>',
          ),
      );

      await expect(store(mock).delete('b', ['gone', 'locked'])).rejects.toThrow(
        /failed for 1 keys \(locked: AccessDenied\)/,
      );
    });

    it('retries a transient batch failure', async () => {
      const mock = mockFetch(
        (_req, i) => new Response('<DeleteResult/>', { status: i === 0 ? 503 : 200 }),
      );

      await store(mock).delete('b', ['a']);

      expect(mock.requests).toHaveLength(2);
      expect(noSleep).toHaveBeenCalledWith(2000);
    });
  });

  describe('presignGet', () => {
    it('returns a query-signed URL with the default 1 h expiry without calling fetch', async () => {
      const mock = mockFetch(() => new Response());

      const url = new URL(await store(mock).presignGet('b', 'reports/x/index.html'));

      expect(mock.requests).toHaveLength(0);
      expect(url.origin + url.pathname).toBe(`${ENDPOINT}/b/reports/x/index.html`);
      expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
      expect(url.searchParams.get('X-Amz-Credential')).toMatch(
        /^AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request$/,
      );
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('honours a custom expiry and rejects out-of-range values', async () => {
      const s = store(mockFetch(() => new Response()));

      const url = new URL(await s.presignGet('b', 'k', 60));
      expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
      await expect(s.presignGet('b', 'k', 0)).rejects.toBeInstanceOf(RangeError);
      await expect(s.presignGet('b', 'k', 7 * 24 * 3600 + 1)).rejects.toBeInstanceOf(RangeError);
    });
  });
});
