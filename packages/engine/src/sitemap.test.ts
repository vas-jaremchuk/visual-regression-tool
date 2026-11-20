import { describe, expect, it } from 'vitest';
import { SITEMAP_USER_AGENT, checkRedirects, extractLocs, fetchSitemap } from './sitemap';
import { fakeFetcher, networkError, readGolden, response } from './test/helpers';

const misc = readGolden<{ extractLocs: { xml: string; locs: string[] } }>('misc.json');

const urlset = (...locs: string[]) =>
  `<?xml version="1.0"?><urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`;
const index = (...locs: string[]) =>
  `<sitemapindex>${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join('')}</sitemapindex>`;

describe('extractLocs', () => {
  it('matches the prototype output', () => {
    expect(extractLocs(misc.extractLocs.xml)).toEqual(misc.extractLocs.locs);
  });
});

describe('fetchSitemap', () => {
  it('fetches child sitemaps, records child failures, dedupes and sorts', async () => {
    const fetcher = fakeFetcher((url) => {
      switch (url) {
        case 'https://example.com/sitemap.xml':
          return response(
            index(
              'https://example.com/s1.xml',
              'https://example.com/s2.xml',
              'https://example.com/gone.xml',
              'https://example.com/down.xml',
            ),
          );
        case 'https://example.com/s1.xml':
          return response(urlset('https://example.com/b', 'https://example.com/a?x=1&amp;y=2'));
        case 'https://example.com/s2.xml':
          return response(urlset('https://example.com/b', 'https://example.com/c.pdf'));
        case 'https://example.com/gone.xml':
          return response('', { status: 404 });
        default:
          throw networkError('ETIMEDOUT');
      }
    });
    const res = await fetchSitemap('https://example.com/sitemap.xml', {
      fetcher,
      headers: { Authorization: 'Basic eDp5' },
    });
    expect(res).toEqual({
      ok: true,
      urls: ['https://example.com/a?x=1&y=2', 'https://example.com/b', 'https://example.com/c.pdf'],
      childSitemaps: 4,
      childErrors: [
        { url: 'https://example.com/gone.xml', error: 'HTTP 404' },
        { url: 'https://example.com/down.xml', error: 'ETIMEDOUT' },
      ],
    });
    const init = fetcher.calls[0]!.init!;
    expect(init.redirect).toBe('follow');
    expect(init.headers).toEqual({ 'User-Agent': SITEMAP_USER_AGENT, Authorization: 'Basic eDp5' });
  });

  it('accepts a plain urlset as the index', async () => {
    const res = await fetchSitemap('https://example.com/sitemap.xml', {
      fetcher: fakeFetcher(() =>
        response(urlset('https://example.com/z', 'https://example.com/a')),
      ),
    });
    expect(res).toEqual({
      ok: true,
      urls: ['https://example.com/a', 'https://example.com/z'],
      childSitemaps: 0,
      childErrors: [],
    });
  });

  it('follows nested sitemap indexes up to the max depth', async () => {
    const fetcher = fakeFetcher((url) => {
      if (url.endsWith('/l0.xml')) return response(index('https://example.com/l1.xml'));
      if (url.endsWith('/l1.xml')) return response(index('https://example.com/l2.xml'));
      if (url.endsWith('/l2.xml'))
        return response(index('https://example.com/l3.xml', 'https://example.com/u.xml'));
      if (url.endsWith('/l3.xml')) return response(index('https://example.com/u.xml'));
      return response(urlset('https://example.com/deep'));
    });
    const res = await fetchSitemap('https://example.com/l0.xml', { fetcher });
    expect(res).toEqual({
      ok: true,
      urls: ['https://example.com/deep'],
      childSitemaps: 4,
      childErrors: [{ url: 'https://example.com/l3.xml', error: 'sitemap nesting deeper than 3' }],
    });
  });

  it('fails when the index is not 200, not a sitemap, or unreachable', async () => {
    const at = (r: () => Response) =>
      fetchSitemap('https://example.com/sitemap.xml', { fetcher: fakeFetcher(r) });
    expect(await at(() => response('', { status: 500 }))).toEqual({
      ok: false,
      error: 'sitemap index returned HTTP 500',
    });
    expect(await at(() => response('<html></html>'))).toEqual({
      ok: false,
      error: 'response does not look like a valid sitemap',
    });
    expect(
      await at(() => {
        throw networkError('ENOTFOUND');
      }),
    ).toEqual({ ok: false, error: 'ENOTFOUND' });
  });
});

describe('checkRedirects', () => {
  it('classifies redirects, errors and HTTP failures', async () => {
    const fetcher = fakeFetcher((url, init) => {
      const path = new URL(url).pathname;
      if (path === '/moved') return response(null, { status: 301, headers: { location: '/new' } });
      if (path === '/temp') return response(null, { status: 302 });
      if (path === '/nohead')
        return init?.method === 'HEAD'
          ? response(null, { status: 405 })
          : response('page', { status: 308, headers: { location: 'https://example.org/x' } });
      if (path === '/gone') return response(null, { status: 404 });
      if (path === '/dead') throw networkError('ECONNRESET');
      return response(null, { status: 200 });
    });
    const urls = ['/ok', '/moved', '/temp', '/nohead', '/gone', '/dead'].map(
      (p) => `https://example.com${p}`,
    );
    expect(await checkRedirects(urls, { fetcher })).toEqual([
      { url: urls[0], httpStatus: 200, redirectTo: null, included: true },
      { url: urls[1], httpStatus: 301, redirectTo: 'https://example.com/new', included: false },
      { url: urls[2], httpStatus: 302, redirectTo: null, included: false },
      { url: urls[3], httpStatus: 308, redirectTo: 'https://example.org/x', included: false },
      { url: urls[4], httpStatus: 404, redirectTo: null, included: true },
      { url: urls[5], httpStatus: null, redirectTo: null, included: true, error: 'ECONNRESET' },
    ]);
    const nohead = fetcher.calls.filter((c) => c.url === urls[3]).map((c) => c.init?.method);
    expect(nohead).toEqual(['HEAD', 'GET']);
    expect(fetcher.calls.every((c) => c.init?.redirect === 'manual')).toBe(true);
  });

  it('runs at most `concurrency` requests at once (default 8)', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetcher = fakeFetcher(async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return response(null);
    });
    const urls = Array.from({ length: 30 }, (_, i) => `https://example.com/p${i}`);
    const res = await checkRedirects(urls, { fetcher });
    expect(res.map((r) => r.url)).toEqual(urls);
    expect(peak).toBe(8);

    peak = 0;
    await checkRedirects(urls, { fetcher, concurrency: 3 });
    expect(peak).toBe(3);
    expect(await checkRedirects([], { fetcher })).toEqual([]);
  });
});
