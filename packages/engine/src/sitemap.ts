/** Sitemap fetch and redirect check (specification/05-engine.md §3, REQ-ENG-3). */
import type { Fetcher } from './types';
import { discardBody, errorReason, mapLimit } from './util';

export const SITEMAP_TIMEOUT_MS = 15_000;
export const SITEMAP_USER_AGENT = 'VisualTestBot/1.0 (visual-regression-test)';
export const REDIRECT_CHECK_CONCURRENCY = 8;
/** Max nesting of sitemap indexes (index → index → urlset). */
export const SITEMAP_MAX_DEPTH = 3;

export interface SitemapFetchOptions {
  fetcher: Fetcher;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxDepth?: number;
}

export interface ChildSitemapError {
  url: string;
  error: string;
}

export type SitemapFetchResult =
  | {
      ok: true;
      /** Unique page/file URLs, sorted. */
      urls: string[];
      /** Number of child sitemaps fetched (0 when the index itself is a urlset). */
      childSitemaps: number;
      childErrors: ChildSitemapError[];
    }
  | { ok: false; error: string };

/** Extracts `<loc>` values (trimmed, `&amp;` decoded) in document order. */
export function extractLocs(xml: string): string[] {
  const urls: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gs)) {
    urls.push((m[1] ?? '').trim().replace(/&amp;/g, '&'));
  }
  return urls;
}

function requestHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  return { 'User-Agent': SITEMAP_USER_AGENT, ...headers };
}

async function getText(
  url: string,
  opts: SitemapFetchOptions,
): Promise<{ status: number; body: string }> {
  const res = await opts.fetcher(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(opts.timeoutMs ?? SITEMAP_TIMEOUT_MS),
    headers: requestHeaders(opts.headers),
  });
  return { status: res.status, body: await res.text() };
}

/**
 * Fetches a sitemap index (or a plain urlset) and returns every URL it lists. Child sitemap
 * failures are recorded in `childErrors`; only a failing index makes the whole fetch fail.
 */
export async function fetchSitemap(
  index: string,
  opts: SitemapFetchOptions,
): Promise<SitemapFetchResult> {
  let res: { status: number; body: string };
  try {
    res = await getText(index, opts);
  } catch (err) {
    return { ok: false, error: errorReason(err) };
  }
  if (res.status !== 200) return { ok: false, error: `sitemap index returned HTTP ${res.status}` };
  if (!res.body.includes('<sitemapindex') && !res.body.includes('<urlset')) {
    return { ok: false, error: 'response does not look like a valid sitemap' };
  }

  const urls: string[] = [];
  const childErrors: ChildSitemapError[] = [];
  let childSitemaps = 0;
  const maxDepth = opts.maxDepth ?? SITEMAP_MAX_DEPTH;

  const visit = async (body: string, depth: number): Promise<void> => {
    if (!body.includes('<sitemapindex')) {
      urls.push(...extractLocs(body));
      return;
    }
    for (const childUrl of extractLocs(body)) {
      childSitemaps++;
      try {
        const child = await getText(childUrl, opts);
        if (child.status !== 200) {
          childErrors.push({ url: childUrl, error: `HTTP ${child.status}` });
        } else if (child.body.includes('<sitemapindex')) {
          if (depth + 1 >= maxDepth) {
            childErrors.push({ url: childUrl, error: `sitemap nesting deeper than ${maxDepth}` });
          } else {
            await visit(child.body, depth + 1);
          }
        } else {
          urls.push(...extractLocs(child.body));
        }
      } catch (err) {
        childErrors.push({ url: childUrl, error: errorReason(err) });
      }
    }
  };
  await visit(res.body, 0);

  return { ok: true, urls: [...new Set(urls)].sort(), childSitemaps, childErrors };
}

export interface RedirectCheckOptions {
  fetcher: Fetcher;
  headers?: Record<string, string>;
  concurrency?: number;
  timeoutMs?: number;
}

export interface RedirectCheckResult {
  url: string;
  /** HTTP status of the un-followed request; null when the URL could not be checked. */
  httpStatus: number | null;
  /** Absolute `Location` of a 3xx response (null if absent or not a redirect). */
  redirectTo: string | null;
  /** False for 3xx responses: redirecting URLs are not captured. */
  included: boolean;
  /** Network error message; the URL is kept. */
  error?: string;
}

async function checkStatus(
  url: string,
  opts: RedirectCheckOptions,
  method: 'HEAD' | 'GET' = 'HEAD',
): Promise<{ status: number; location: string | null }> {
  const res = await opts.fetcher(url, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(opts.timeoutMs ?? SITEMAP_TIMEOUT_MS),
    headers: requestHeaders(opts.headers),
  });
  await discardBody(res);
  if (method === 'HEAD' && (res.status === 405 || res.status === 501)) {
    return checkStatus(url, opts, 'GET');
  }
  const location = res.headers.get('location');
  return { status: res.status, location: location ? new URL(location, url).href : null };
}

/**
 * Requests every URL without following redirects (HEAD, GET fallback on 405/501).
 * 3xx → excluded with `redirectTo`; network error → kept with `httpStatus = null`;
 * ≥ 400 → kept with the status recorded.
 */
export async function checkRedirects(
  urls: readonly string[],
  opts: RedirectCheckOptions,
): Promise<RedirectCheckResult[]> {
  return mapLimit(urls, opts.concurrency ?? REDIRECT_CHECK_CONCURRENCY, async (url) => {
    try {
      const { status, location } = await checkStatus(url, opts);
      const redirect = status >= 300 && status < 400;
      return {
        url,
        httpStatus: status,
        redirectTo: redirect ? location : null,
        included: !redirect,
      };
    } catch (err) {
      return { url, httpStatus: null, redirectTo: null, included: true, error: errorReason(err) };
    }
  });
}
