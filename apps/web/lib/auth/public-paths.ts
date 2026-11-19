/** Routes reachable without a session (08 §1). Everything else redirects to /login. */
const PUBLIC_ROUTES = ['/login', '/auth', '/invite', '/share'];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}
