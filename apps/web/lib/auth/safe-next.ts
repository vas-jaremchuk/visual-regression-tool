/**
 * Sanitises the `next` redirect target: only same-origin absolute paths are allowed, so a
 * crafted `/login?next=https://evil.example` cannot send a user off-site after sign-in.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (next.startsWith('/login') || next.startsWith('/auth/')) return '/';
  return next;
}
