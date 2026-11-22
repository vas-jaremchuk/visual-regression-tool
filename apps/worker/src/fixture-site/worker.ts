import { fixtureSiteEnv, parseEnv } from '@vrt/shared';
import { contentType, renderFixtureBody, routeFixturePath, versionRoot } from './routing';

/**
 * Staging fixture site (specification/11-testing.md §4), deployed with
 * `wrangler deploy --config wrangler.fixture-site.jsonc`. `fixtures/site/` is uploaded as static
 * assets; `SITE_VERSION` picks `v1` or `v2` and is switched by redeploying with
 * `--var SITE_VERSION:v2`. `GET /__fixture/version` reports the version being served, so the
 * staging suite can wait until a switch has propagated.
 */

export interface FixtureSiteBindings {
  ASSETS: Fetcher;
  SITE_VERSION?: string;
}

export const VERSION_PATH = '/__fixture/version';

export async function handleFixtureRequest(
  request: Request,
  env: FixtureSiteBindings,
): Promise<Response> {
  const { SITE_VERSION: version } = parseEnv(fixtureSiteEnv, { ...env }, 'fixture site');
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  if (url.pathname === VERSION_PATH) {
    return Response.json({ version }, { headers: { 'cache-control': 'no-store' } });
  }

  const routes = await env.ASSETS.fetch(new URL(`${versionRoot(version)}routes.json`, url));
  const { redirects } = (await routes.json()) as { redirects: Record<string, string> };
  const route = routeFixturePath(url.pathname, version, redirects);
  if (route.kind === 'redirect') {
    return new Response(null, { status: 301, headers: { location: route.location } });
  }
  if (route.kind === 'not-found') return new Response(null, { status: 404 });

  const asset = await env.ASSETS.fetch(new URL(route.path, url));
  if (!asset.ok) return new Response(null, { status: 404 });
  const body = renderFixtureBody(route.path, new Uint8Array(await asset.arrayBuffer()), url.origin);
  return new Response(request.method === 'HEAD' ? null : body, {
    headers: { 'content-type': contentType(route.path), 'cache-control': 'no-store' },
  });
}

export default {
  fetch: (request, env) => handleFixtureRequest(request, env),
} satisfies ExportedHandler<FixtureSiteBindings>;
