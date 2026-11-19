/** Redirect detection at compare time (specification/05-engine.md §7, REQ-ENG-7). */
import { REDIRECT_MAX_HOPS, REDIRECT_TIMEOUT_MS } from '@vrt/shared';
import type { Fetcher } from './types';
import { discardBody } from './util';

export const REDIRECT_USER_AGENT = 'Mozilla/5.0 (visual-test redirect check)';

/** Same page = same host + path + query, ignoring protocol, "www." and trailing slash. */
export function samePage(a: string, b: string): boolean {
  const norm = (u: string) => {
    const x = new URL(u);
    const host = x.host.replace(/^www\./i, '').toLowerCase();
    const p = x.pathname.replace(/\/+$/, '') || '/';
    return `${host}${p}${x.search}`;
  };
  try {
    return norm(a) === norm(b);
  } catch {
    return false;
  }
}

export interface DetectRedirectOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxHops?: number;
}

/**
 * Follows redirects manually. Returns the final URL if the page ends up on a different page
 * than requested, otherwise null. Network errors → null (the page is compared as usual).
 */
export async function detectRedirect(
  url: string,
  fetcher: Fetcher,
  opts: DetectRedirectOptions = {},
): Promise<string | null> {
  let current = url;
  try {
    for (let hop = 0; hop < (opts.maxHops ?? REDIRECT_MAX_HOPS); hop++) {
      const res = await fetcher(current, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(opts.timeoutMs ?? REDIRECT_TIMEOUT_MS),
        headers: { 'User-Agent': REDIRECT_USER_AGENT, ...opts.headers },
      });
      await discardBody(res);
      const location = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !location) break;
      current = new URL(location, current).toString();
    }
  } catch {
    return null;
  }
  return samePage(url, current) ? null : current;
}
