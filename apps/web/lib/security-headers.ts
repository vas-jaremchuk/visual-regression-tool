/**
 * Security headers for every web app response (NFR-15). Kept free of Next.js and env imports so
 * next.config.ts can load it and tests can check it.
 */

export interface SecurityHeaderOptions {
  /** NEXT_PUBLIC_SUPABASE_URL: the browser talks to Supabase Auth, REST and Realtime. */
  supabaseUrl?: string;
  /** `next dev` needs eval for React Refresh. */
  dev?: boolean;
}

function supabaseOrigins(supabaseUrl: string | undefined): string[] {
  if (!supabaseUrl) return [];
  try {
    const url = new URL(supabaseUrl);
    const ws = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return [url.origin, `${ws}//${url.host}`];
  } catch {
    return [];
  }
}

export function contentSecurityPolicy({ supabaseUrl, dev = false }: SecurityHeaderOptions) {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // Next.js streams the RSC payload in inline scripts and next-themes sets the theme inline.
    'script-src': ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    // Screenshots come from signed R2 URLs or a project's public bucket URL (09 §1).
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", ...supabaseOrigins(supabaseUrl)],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

export function securityHeaders(options: SecurityHeaderOptions): { key: string; value: string }[] {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(options) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ...(options.dev
      ? []
      : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
  ];
}
