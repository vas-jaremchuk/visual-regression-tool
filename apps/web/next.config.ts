import type { NextConfig } from 'next';
import { securityHeaders } from './lib/security-headers';

const nextConfig: NextConfig = {
  // `forbidden()` renders app/forbidden.tsx with a 403 (settings for non-admins, 04 §3).
  experimental: { authInterrupts: true },
  poweredByHeader: false,
  // CSP and security headers on every response (NFR-15).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          dev: process.env.NODE_ENV === 'development',
        }),
      },
    ];
  },
};

export default nextConfig;
