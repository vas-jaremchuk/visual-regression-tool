import { describe, expect, it } from 'vitest';
import { REDIRECT_USER_AGENT, detectRedirect, samePage } from './redirect';
import { fakeFetcher, networkError, readGolden, response } from './test/helpers';

const misc = readGolden<{ samePage: { a: string; b: string; same: boolean }[] }>('misc.json');

describe('samePage', () => {
  it('matches the prototype', () => {
    for (const c of misc.samePage) expect(samePage(c.a, c.b), `${c.a} vs ${c.b}`).toBe(c.same);
  });
});

describe('detectRedirect', () => {
  const chain = (hops: Record<string, string>) =>
    fakeFetcher((url) => {
      const to = hops[url];
      return to ? response(null, { status: 301, headers: { location: to } }) : response('ok');
    });

  it('returns the final URL when it is a different page', async () => {
    const fetcher = chain({
      'https://example.com/old': '/step',
      'https://example.com/step': 'https://example.com/new',
    });
    expect(
      await detectRedirect('https://example.com/old', fetcher, { headers: { Authorization: 'x' } }),
    ).toBe('https://example.com/new');
    expect(fetcher.calls.map((c) => c.url)).toEqual([
      'https://example.com/old',
      'https://example.com/step',
      'https://example.com/new',
    ]);
    expect(fetcher.calls[0]!.init).toMatchObject({
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': REDIRECT_USER_AGENT, Authorization: 'x' },
    });
  });

  it('ignores redirects to the same page (protocol, www, trailing slash)', async () => {
    const fetcher = chain({ 'https://example.com/a': 'http://www.example.com/a/' });
    expect(await detectRedirect('https://example.com/a', fetcher)).toBeNull();
    expect(await detectRedirect('https://example.com/b', chain({}))).toBeNull();
  });

  it('treats a 3xx without Location as no redirect', async () => {
    const fetcher = fakeFetcher(() => response(null, { status: 302 }));
    expect(await detectRedirect('https://example.com/a', fetcher)).toBeNull();
  });

  it('stops after maxHops', async () => {
    let n = 0;
    const fetcher = fakeFetcher(() =>
      response(null, { status: 302, headers: { location: `/loop${++n}` } }),
    );
    expect(await detectRedirect('https://example.com/a', fetcher)).toBe(
      'https://example.com/loop10',
    );
    expect(fetcher.calls).toHaveLength(10);
  });

  it('treats network errors as no redirect', async () => {
    const fetcher = fakeFetcher(() => {
      throw networkError('ECONNREFUSED');
    });
    expect(await detectRedirect('https://example.com/a', fetcher)).toBeNull();
  });
});
