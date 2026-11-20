/**
 * SSRF guard (NFR-14): sitemap, capture and fingerprint fetches go only to `http(s)` URLs whose
 * host does not resolve to a private, loopback, link-local or otherwise non-public address.
 * Hosts listed in `SSRF_ALLOW_HOSTS` skip the address check (local development and tests only).
 * Runtime-agnostic: DNS resolution and `fetch` are injected.
 */

/** Resolves a hostname to its IPv4/IPv6 addresses. */
export type HostResolver = (hostname: string) => Promise<string[]>;

export interface SsrfGuardOptions {
  /** Without a resolver only literal IPs and well-known local names are checked. */
  resolve?: HostResolver;
  /** Lower-case hostnames (or `host:port`) that are exempt from the address check. */
  allowHosts?: readonly string[];
}

export class SsrfBlockedError extends Error {
  readonly url: string;

  constructor(url: string, reason: string) {
    super(`Blocked request to ${url}: ${reason}`);
    this.name = 'SsrfBlockedError';
    this.url = url;
  }
}

/** Parses the comma-separated `SSRF_ALLOW_HOSTS` value. */
export function parseAllowHosts(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

function isPrivateIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a! >= 224 // multicast, reserved, broadcast
  );
}

/** Expands an IPv6 address into its eight 16-bit groups, or null when it is not one. */
function parseIpv6(ip: string): number[] | null {
  let addr = ip.replace(/^\[|\]$/g, '').toLowerCase();
  const zone = addr.indexOf('%');
  if (zone >= 0) addr = addr.slice(0, zone);
  if (!addr.includes(':')) return null;
  // Trailing dotted IPv4 (e.g. ::ffff:127.0.0.1)
  const lastColon = addr.lastIndexOf(':');
  const tail = addr.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    addr = `${addr.slice(0, lastColon + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const parsed = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return parsed.some(Number.isNaN) ? null : parsed;
}

function isPrivateIpv6(g: number[]): boolean {
  const allZeroUntil = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (allZeroUntil(8)) return true; // ::
  if (allZeroUntil(7) && g[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
  if (allZeroUntil(5) && (g[5] === 0xffff || g[5] === 0)) {
    return isPrivateIpv4([g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff]);
  }
  // NAT64 (64:ff9b::/96) embeds an IPv4 address
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateIpv4([g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff]);
  }
  const first = g[0]!;
  return (
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xffc0) === 0xfec0 || // site-local (deprecated)
    (first & 0xff00) === 0xff00 // multicast
  );
}

/** True for an IP literal that is not publicly routable; false for public IPs and non-IPs. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4) return isPrivateIpv4(v4);
  const v6 = parseIpv6(ip);
  return v6 ? isPrivateIpv6(v6) : false;
}

function isIpLiteral(host: string): boolean {
  return parseIpv4(host) !== null || parseIpv6(host) !== null;
}

const LOCAL_NAME = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/;

function isAllowed(url: URL, allowHosts: readonly string[] | undefined): boolean {
  if (!allowHosts?.length) return false;
  const host = url.hostname.toLowerCase();
  return allowHosts.includes(host) || allowHosts.includes(url.host.toLowerCase());
}

/**
 * Throws `SsrfBlockedError` unless `rawUrl` is an `http(s)` URL whose host is public (literal IP
 * or every resolved address). Returns the parsed URL.
 */
export async function assertPublicUrl(rawUrl: string, opts: SsrfGuardOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl, 'not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(rawUrl, `protocol ${url.protocol} is not allowed`);
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError(rawUrl, 'credentials in the URL are not allowed');
  }
  if (isAllowed(url, opts.allowHosts)) return url;

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (isIpLiteral(host)) {
    if (isPrivateAddress(host)) throw new SsrfBlockedError(rawUrl, `${host} is a private address`);
    return url;
  }
  if (LOCAL_NAME.test(host)) throw new SsrfBlockedError(rawUrl, `${host} is a local host name`);
  if (opts.resolve) {
    let addresses: string[];
    try {
      addresses = await opts.resolve(host);
    } catch (error) {
      throw new SsrfBlockedError(rawUrl, `${host} could not be resolved (${String(error)})`);
    }
    if (addresses.length === 0) throw new SsrfBlockedError(rawUrl, `${host} does not resolve`);
    const blocked = addresses.find(isPrivateAddress);
    if (blocked)
      throw new SsrfBlockedError(rawUrl, `${host} resolves to private address ${blocked}`);
  }
  return url;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const MAX_REDIRECTS = 10;

/**
 * Wraps `fetchFn` so every request, and every redirect hop of a `redirect: 'follow'` request,
 * passes `assertPublicUrl` first. Redirects are followed manually so a public URL cannot bounce
 * the request to a private one.
 */
export function guardedFetch(fetchFn: FetchLike, opts: SsrfGuardOptions = {}): FetchLike {
  return async (input, init = {}) => {
    const follow = (init.redirect ?? 'follow') === 'follow';
    let url = input;
    let method = init.method ?? 'GET';
    let body = init.body;
    for (let hop = 0; ; hop++) {
      await assertPublicUrl(url, opts);
      const res = await fetchFn(url, { ...init, method, body, redirect: 'manual' });
      const location = res.headers.get('location');
      if (!follow || res.status < 300 || res.status >= 400 || !location) return res;
      if (hop >= MAX_REDIRECTS) throw new SsrfBlockedError(input, 'too many redirects');
      await res.body?.cancel().catch(() => undefined);
      url = new URL(location, url).href;
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
      }
    }
  };
}
