import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // `forbidden()` renders app/forbidden.tsx with a 403 (settings for non-admins, 04 §3).
  experimental: { authInterrupts: true },
};

export default nextConfig;
