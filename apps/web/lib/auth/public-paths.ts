/**
 * Routes reachable without a session (08 §1). Everything else redirects to /login. The share API
 * and the signing endpoint check a share token or the session themselves.
 */
const PUBLIC_ROUTES = ['/login', '/auth', '/invite', '/share', '/api/share', '/api/r2/sign'];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}
