/**
 * Project slug of a settings page only project admins may open (`/p/<slug>/settings[/<tab>]`),
 * or null. The Members tab is readable by every member (04 §4).
 */
export function adminSettingsSlug(pathname: string): string | null {
  const match = /^\/p\/([^/]+)\/settings(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!match || match[2] === 'members') return null;
  return decodeURIComponent(match[1]!);
}
