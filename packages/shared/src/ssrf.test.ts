import { describe, expect, it, vi } from 'vitest';
import {
  assertPublicUrl,
  guardedFetch,
  isPrivateAddress,
  parseAllowHosts,
  SsrfBlockedError,
} from './ssrf';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a00:1',
  ])('%s is private', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '172.32.0.1', '93.184.216.34', '2606:4700::1111', '::ffff:8.8.8.8'])(
    '%s is public',
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );

  it('is false for host names', () => expect(isPrivateAddress('example.com')).toBe(false));
});

describe('assertPublicUrl', () => {
  it.each([
    'http://127.0.0.1/sitemap.xml',
    'http://[::1]:8080/',
    'http://169.254.169.254/latest/meta-data',
    'http://2130706433/', // 127.0.0.1 in decimal; the URL parser normalises it
    'http://localhost:3000/',
    'http://intranet.local/',
    'ftp://example.com/sitemap.xml',
    'file:///etc/passwd',
    'http://user:pass@example.com/',
    'not a url',
  ])('rejects %s', async (url) => {
    await expect(assertPublicUrl(url)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('accepts public URLs', async () => {
    await expect(assertPublicUrl('https://example.com/sitemap.xml')).resolves.toBeInstanceOf(URL);
    await expect(assertPublicUrl('http://8.8.8.8/')).resolves.toBeInstanceOf(URL);
  });

  it('rejects host names that resolve to a private address', async () => {
    const resolve = vi.fn(async () => ['93.184.216.34', '10.0.0.5']);
    await expect(assertPublicUrl('https://evil.example/', { resolve })).rejects.toThrow(
      /resolves to private address 10\.0\.0\.5/,
    );
    expect(resolve).toHaveBeenCalledWith('evil.example');
  });

  it('rejects host names that do not resolve', async () => {
    await expect(
      assertPublicUrl('https://nowhere.example/', { resolve: async () => [] }),
    ).rejects.toThrow(/does not resolve/);
  });

  it('lets allow-listed hosts through', async () => {
    const allowHosts = parseAllowHosts(' LocalHost:4010 , 127.0.0.1 ');
    expect(allowHosts).toEqual(['localhost:4010', '127.0.0.1']);
    await expect(assertPublicUrl('http://localhost:4010/', { allowHosts })).resolves.toBeDefined();
    await expect(assertPublicUrl('http://127.0.0.1:9999/', { allowHosts })).resolves.toBeDefined();
    await expect(assertPublicUrl('http://localhost:4011/', { allowHosts })).rejects.toThrow();
  });
});

describe('guardedFetch', () => {
  it('blocks a redirect from a public URL to a private one', async () => {
    const inner = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/' } }),
    );
    const guarded = guardedFetch(inner);
    await expect(guarded('https://example.com/sitemap.xml')).rejects.toThrow(/private address/);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('follows public redirects manually', async () => {
    const inner = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
      url === 'https://example.com/a'
        ? new Response(null, { status: 301, headers: { location: '/b' } })
        : new Response('ok'),
    );
    const res = await guardedFetch(inner)('https://example.com/a');
    expect(await res.text()).toBe('ok');
    expect(inner.mock.calls.map((c) => c[0])).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
    expect(inner.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('returns redirects untouched for redirect: manual', async () => {
    const inner = vi.fn(
      async () => new Response(null, { status: 301, headers: { location: 'http://10.0.0.1/' } }),
    );
    const res = await guardedFetch(inner)('https://example.com/', { redirect: 'manual' });
    expect(res.status).toBe(301);
  });

  it('never calls fetch for a blocked URL', async () => {
    const inner = vi.fn(async () => new Response('ok'));
    await expect(guardedFetch(inner)('http://192.168.0.1/')).rejects.toThrow(SsrfBlockedError);
    expect(inner).not.toHaveBeenCalled();
  });
});
