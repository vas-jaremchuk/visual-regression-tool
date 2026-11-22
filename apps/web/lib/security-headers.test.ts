import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';
import { contentSecurityPolicy, securityHeaders } from './security-headers';

function directives(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp.split('; ').map((d) => {
      const [name, ...values] = d.split(' ');
      return [name!, values];
    }),
  );
}

describe('security headers (NFR-15)', () => {
  it('sends a CSP that blocks framing, plugins and foreign scripts', () => {
    const csp = directives(contentSecurityPolicy({ supabaseUrl: 'https://abc.supabase.co' }));
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['script-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
    expect(csp['connect-src']).toEqual([
      "'self'",
      'https://abc.supabase.co',
      'wss://abc.supabase.co',
    ]);
  });

  it('allows eval only in development and a local Supabase over ws', () => {
    const csp = directives(
      contentSecurityPolicy({ supabaseUrl: 'http://127.0.0.1:54321', dev: true }),
    );
    expect(csp['script-src']).toContain("'unsafe-eval'");
    expect(csp['connect-src']).toEqual([
      "'self'",
      'http://127.0.0.1:54321',
      'ws://127.0.0.1:54321',
    ]);
  });

  it('adds nosniff, frame, referrer and HSTS headers outside development', () => {
    const names = (dev: boolean) => securityHeaders({ dev }).map((h) => h.key);
    expect(names(false)).toEqual([
      'Content-Security-Policy',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Strict-Transport-Security',
    ]);
    expect(names(true)).not.toContain('Strict-Transport-Security');
  });

  it('applies the headers to every route in next.config', async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe('/:path*');
    expect(rules[0]!.headers.map((h) => h.key)).toContain('Content-Security-Policy');
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
