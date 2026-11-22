import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  contentType,
  renderFixtureBody,
  routeFixturePath,
  versionRoot,
  type SiteVersion,
} from '../fixture-site/routing';

/**
 * Serves `fixtures/site/` on 127.0.0.1 (specification/11-testing.md §2). `{{origin}}` in XML
 * files becomes the server origin; `routes.json` declares redirects; unknown paths are 404.
 * With `basicAuth` every request needs those credentials; `version: 'v2'` serves `site/v2/` under
 * the same URLs (routing shared with the staging Worker, `src/fixture-site/`).
 */

const ROOT = fileURLToPath(new URL('../../../../fixtures/site/', import.meta.url).href);

export interface FixtureSite {
  origin: string;
  /** Paths requested so far, with method. */
  requests: string[];
  close(): Promise<void>;
}

export async function startFixtureSite(
  opts: { basicAuth?: { user: string; pass: string }; version?: SiteVersion } = {},
): Promise<FixtureSite> {
  const version = opts.version ?? 'v1';
  const routes = JSON.parse(
    await readFile(join(ROOT, versionRoot(version), 'routes.json'), 'utf8'),
  ) as {
    redirects: Record<string, string>;
  };
  const requests: string[] = [];
  let origin = '';
  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', origin).pathname;
      requests.push(`${req.method} ${path}`);
      if (opts.basicAuth) {
        const expected =
          'Basic ' +
          Buffer.from(`${opts.basicAuth.user}:${opts.basicAuth.pass}`).toString('base64');
        if (req.headers.authorization !== expected) {
          res.writeHead(401, { 'www-authenticate': 'Basic realm="fixture"' }).end();
          return;
        }
      }
      const route = routeFixturePath(path, version, routes.redirects);
      if (route.kind === 'redirect') {
        res.writeHead(301, { location: route.location }).end();
        return;
      }
      if (route.kind === 'not-found') {
        res.writeHead(404).end();
        return;
      }
      let body: Buffer;
      try {
        body = await readFile(join(ROOT, route.path));
      } catch {
        res.writeHead(404).end();
        return;
      }
      const content = renderFixtureBody(route.path, body, origin);
      res.writeHead(200, { 'content-type': contentType(route.path) });
      res.end(req.method === 'HEAD' ? undefined : content);
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
