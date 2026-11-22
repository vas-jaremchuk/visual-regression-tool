/**
 * Request routing of the fixture site (specification/11-testing.md §2), shared by the local test
 * server (`src/test/fixture-site.ts`) and the staging Worker (`worker.ts`). Version `v1` serves
 * `fixtures/site/`, `v2` serves `fixtures/site/v2/` under the same URLs, so a run before and a run
 * after switching compare the same pages.
 */

export const SITE_VERSIONS = ['v1', 'v2'] as const;
export type SiteVersion = (typeof SITE_VERSIONS)[number];

export type FixtureRoute =
  { kind: 'redirect'; location: string } | { kind: 'file'; path: string } | { kind: 'not-found' };

export function isSiteVersion(value: unknown): value is SiteVersion {
  return SITE_VERSIONS.includes(value as SiteVersion);
}

/** Directory of `version` relative to `fixtures/site/`, ending in `/`. */
export function versionRoot(version: SiteVersion): string {
  return version === 'v1' ? '/' : `/${version}/`;
}

/**
 * Maps a request path to a file under `fixtures/site/` (`/about/` → `/about/index.html`), a
 * redirect from the version's `routes.json`, or a 404. Other versions' folders and `routes.json`
 * itself are never served.
 */
export function routeFixturePath(
  path: string,
  version: SiteVersion,
  redirects: Record<string, string>,
): FixtureRoute {
  const redirect = redirects[path];
  if (redirect) return { kind: 'redirect', location: redirect };
  const segments = path.split('/');
  if (
    !path.startsWith('/') ||
    segments.some((s) => s === '..' || s === '.') ||
    isSiteVersion(segments[1]) ||
    path.endsWith('/routes.json')
  ) {
    return { kind: 'not-found' };
  }
  const file = path.endsWith('/') ? `${path}index.html` : path;
  return { kind: 'file', path: `${versionRoot(version).slice(0, -1)}${file}` };
}

export const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
};

export function contentType(path: string): string {
  const ext = /\.[a-z0-9]+$/i.exec(path)?.[0] ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** XML files name their own origin as `{{origin}}`. */
export function renderFixtureBody(path: string, body: Uint8Array, origin: string): Uint8Array {
  if (!path.endsWith('.xml')) return body;
  return new TextEncoder().encode(new TextDecoder().decode(body).replaceAll('{{origin}}', origin));
}
