import { describe, expect, it } from 'vitest';
import {
  escapeLike,
  isSnapshotStale,
  matchesFilter,
  pageCount,
  parseSitemapQuery,
  sitemapHref,
  type UrlRowLike,
} from './filters';

const ID = '0b6f3a0e-1f5c-4c4e-9a59-0f6d7d1c2b3a';

const page: UrlRowLike = {
  url: 'https://example.com/',
  kind: 'page',
  httpStatus: 200,
  redirectTo: null,
  included: true,
};
const redirect: UrlRowLike = {
  url: 'https://example.com/old',
  kind: 'page',
  httpStatus: 301,
  redirectTo: 'https://example.com/new',
  included: false,
};
const notFound: UrlRowLike = { ...page, url: 'https://example.com/gone', httpStatus: 404 };
const unchecked: UrlRowLike = { ...page, url: 'https://example.com/x', httpStatus: null };
const file: UrlRowLike = { ...page, url: 'https://example.com/a.pdf', kind: 'file' };

describe('parseSitemapQuery', () => {
  it('returns defaults for empty params', () => {
    expect(parseSitemapQuery({})).toEqual({ snapshotId: null, filter: 'all', search: '', page: 1 });
  });

  it('reads valid params', () => {
    expect(parseSitemapQuery({ snapshot: ID, filter: 'errors', q: ' blog ', page: '3' })).toEqual({
      snapshotId: ID,
      filter: 'errors',
      search: 'blog',
      page: 3,
    });
  });

  it('ignores invalid values', () => {
    expect(
      parseSitemapQuery({ snapshot: 'nope', filter: 'weird', page: '-2', q: ['a', 'b'] }),
    ).toEqual({ snapshotId: null, filter: 'all', search: 'a', page: 1 });
    expect(parseSitemapQuery({ page: '1.5' }).page).toBe(1);
  });
});

describe('sitemapHref', () => {
  it('omits defaults', () => {
    expect(sitemapHref('shop', { filter: 'all', page: 1 })).toBe('/p/shop/sitemap');
  });

  it('encodes the query', () => {
    expect(sitemapHref('shop', { snapshotId: ID, filter: 'files', search: 'a b', page: 2 })).toBe(
      `/p/shop/sitemap?snapshot=${ID}&filter=files&q=a+b&page=2`,
    );
  });
});

describe('escapeLike', () => {
  it('escapes wildcard characters', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});

describe('matchesFilter', () => {
  const rows = [page, redirect, notFound, unchecked, file];
  const pick = (filter: Parameters<typeof matchesFilter>[1], checked = true) =>
    rows.filter((row) => matchesFilter(row, filter, checked)).map((row) => row.url);

  it('splits included and excluded', () => {
    expect(pick('all')).toHaveLength(5);
    expect(pick('included')).not.toContain(redirect.url);
    expect(pick('excluded')).toEqual([redirect.url]);
  });

  it('treats 3xx and redirect targets as redirects, not errors', () => {
    expect(pick('redirects')).toEqual([redirect.url]);
    expect(matchesFilter({ ...page, httpStatus: 302 }, 'redirects', true)).toBe(true);
    expect(matchesFilter({ ...page, httpStatus: 302 }, 'errors', true)).toBe(false);
  });

  it('counts a missing status as an error only on checked snapshots', () => {
    expect(pick('errors')).toEqual([notFound.url, unchecked.url]);
    expect(pick('errors', false)).toEqual([notFound.url]);
  });

  it('filters files', () => {
    expect(pick('files')).toEqual([file.url]);
  });
});

describe('pageCount', () => {
  it('has at least one page', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(100)).toBe(1);
    expect(pageCount(101)).toBe(2);
  });
});

describe('isSnapshotStale', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  it('flags snapshots older than 7 days', () => {
    expect(isSnapshotStale('2026-11-13T11:59:00Z', now)).toBe(true);
    expect(isSnapshotStale('2026-11-14T12:00:00Z', now)).toBe(false);
  });
});
