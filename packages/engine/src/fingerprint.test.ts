import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  FINGERPRINT_USER_AGENT,
  fingerprintFilename,
  fingerprintUrl,
  formatFingerprint,
  parseFingerprint,
  type Fingerprint,
} from './fingerprint';
import { fakeFetcher, networkError, readGolden, response } from './test/helpers';

interface GoldenFingerprint {
  input: Fingerprint;
  text: string;
  parsed: Record<string, string>;
}

const NOW = new Date('2026-11-19T12:00:00.000Z');
const now = () => NOW;
const sleep = vi.fn(async () => {});

describe('formatFingerprint / parseFingerprint', () => {
  const golden = readGolden<GoldenFingerprint[]>('fingerprints.json');

  it('is byte-identical with the prototype output', () => {
    for (const g of golden) expect(formatFingerprint(g.input)).toBe(g.text);
  });

  it('parses like the prototype and round-trips', () => {
    for (const g of golden) {
      expect(parseFingerprint(g.text)).toEqual(g.parsed);
      expect(parseFingerprint(g.text.replace(/\n/g, '\r\n'))).toEqual(g.parsed);
    }
    expect(parseFingerprint(':no key\nnot a pair\nurl: https://x.test/a:b')).toEqual({
      url: 'https://x.test/a:b',
    });
  });

  it('builds the fingerprint filename from the screenshot filename', () => {
    expect(fingerprintFilename('downloads_report.pdf.png')).toBe('downloads_report.pdf.txt');
    expect(fingerprintFilename('a.PNG')).toBe('a.txt');
  });
});

describe('fingerprintUrl', () => {
  const body = new TextEncoder().encode('%PDF-1.7 fixture body');
  const sha = createHash('sha256').update(body).digest('hex');

  it('hashes the streamed body and records response metadata', async () => {
    const fetcher = fakeFetcher(() =>
      response(body, {
        status: 200,
        url: 'https://cdn.example.com/report.pdf',
        headers: { 'content-type': 'application/pdf', etag: '"e1"', 'last-modified': 'Wed' },
      }),
    );
    const fp = await fingerprintUrl(
      'https://example.com/report.pdf',
      { Authorization: 'Basic eDp5' },
      fetcher,
      { now, sleep },
    );
    expect(fp).toEqual({
      url: 'https://example.com/report.pdf',
      finalUrl: 'https://cdn.example.com/report.pdf',
      status: 200,
      contentType: 'application/pdf',
      lastModified: 'Wed',
      etag: '"e1"',
      fetchedAt: NOW.toISOString(),
      sha256: sha,
      size: body.length,
    });
    const init = fetcher.calls[0]!.init!;
    expect(init.redirect).toBe('follow');
    expect(init.headers).toEqual({
      'User-Agent': FINGERPRINT_USER_AGENT,
      Authorization: 'Basic eDp5',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('leaves finalUrl empty when not redirected and handles an empty body', async () => {
    const url = 'https://example.com/empty.txt';
    const fp = await fingerprintUrl(
      url,
      {},
      fakeFetcher(() => response(null, { url })),
      { now },
    );
    expect(fp.finalUrl).toBe('');
    expect(fp.size).toBe(0);
    expect(fp.sha256).toBe(createHash('sha256').digest('hex'));
  });

  it('returns ERROR HTTP <status> without retrying a 404', async () => {
    const fetcher = fakeFetcher(() => response('nope', { status: 404 }));
    const fp = await fingerprintUrl('https://example.com/missing.pdf', {}, fetcher, { now, sleep });
    expect(fp.sha256).toBe('ERROR HTTP 404');
    expect(fp.size).toBe(0);
    expect(fp.status).toBe(404);
    expect(fetcher.calls).toHaveLength(1);
  });

  it('retries 429/5xx with attempt*2s backoff, then succeeds', async () => {
    sleep.mockClear();
    let n = 0;
    const fetcher = fakeFetcher(() =>
      ++n < 3 ? response('busy', { status: n === 1 ? 503 : 429 }) : response(body),
    );
    const fp = await fingerprintUrl('https://example.com/r.pdf', {}, fetcher, { now, sleep });
    expect(fp.sha256).toBe(sha);
    expect(fetcher.calls).toHaveLength(3);
    expect(sleep.mock.calls).toEqual([[2000], [4000]]);
  });

  it('gives up after 3 attempts on a persistent 5xx', async () => {
    const fetcher = fakeFetcher(() => response('down', { status: 502 }));
    const fp = await fingerprintUrl('https://example.com/r.pdf', {}, fetcher, { now, sleep });
    expect(fp.sha256).toBe('ERROR HTTP 502');
    expect(fetcher.calls).toHaveLength(3);
  });

  it('never throws on network errors: ERROR <code>', async () => {
    sleep.mockClear();
    const fetcher = fakeFetcher(() => {
      throw networkError('ECONNREFUSED');
    });
    const fp = await fingerprintUrl('https://example.com/r.zip', {}, fetcher, { now, sleep });
    expect(fp).toEqual({
      url: 'https://example.com/r.zip',
      finalUrl: '',
      status: 0,
      contentType: '',
      lastModified: '',
      etag: '',
      fetchedAt: NOW.toISOString(),
      sha256: 'ERROR ECONNREFUSED',
      size: 0,
    });
    expect(fetcher.calls).toHaveLength(3);
    expect(sleep.mock.calls).toEqual([[2000], [4000]]);
  });

  it('reports the error message when there is no code, and a failing stream', async () => {
    const plain = fakeFetcher(() => {
      throw new Error('boom');
    });
    expect((await fingerprintUrl('https://x.test/a.pdf', {}, plain, { now, sleep })).sha256).toBe(
      'ERROR boom',
    );

    const broken = fakeFetcher(
      () =>
        new Response(
          new ReadableStream({
            pull(c) {
              c.error(Object.assign(new Error('reset'), { code: 'ECONNRESET' }));
            },
          }),
        ),
    );
    const fp = await fingerprintUrl('https://x.test/b.pdf', {}, broken, { now, sleep, retries: 1 });
    expect(fp.sha256).toBe('ERROR ECONNRESET');
    expect(broken.calls).toHaveLength(1);

    const weird = fakeFetcher(() => {
      throw 'string failure';
    });
    expect(
      (await fingerprintUrl('https://x.test/c.pdf', {}, weird, { now, sleep, retries: 1 })).sha256,
    ).toBe('ERROR string failure');
  });

  it('uses real timers and clock by default', async () => {
    const fp = await fingerprintUrl(
      'https://example.com/a.pdf',
      {},
      fakeFetcher(() => response(body)),
    );
    expect(fp.sha256).toBe(sha);
    expect(Date.parse(fp.fetchedAt)).not.toBeNaN();
  });
});
