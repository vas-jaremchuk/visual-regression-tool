import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Serves `fixtures/site/` on 127.0.0.1 (specification/11-testing.md §2). `{{origin}}` in XML
 * files becomes the server origin; `routes.json` declares redirects; unknown paths are 404.
 * With `basicAuth` every request needs those credentials.
 */

const ROOT = fileURLToPath(new URL('../../../../fixtures/site/', import.meta.url).href);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
};

export interface FixtureSite {
  origin: string;
  /** Paths requested so far, with method. */
  requests: string[];
  close(): Promise<void>;
}

export async function startFixtureSite(
  opts: { basicAuth?: { user: string; pass: string } } = {},
): Promise<FixtureSite> {
  const routes = JSON.parse(await readFile(join(ROOT, 'routes.json'), 'utf8')) as {
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
      const redirect = routes.redirects[path];
      if (redirect) {
        res.writeHead(301, { location: redirect }).end();
        return;
      }
      const file = normalize(join(ROOT, path.endsWith('/') ? `${path}index.html` : path));
      if (!file.startsWith(ROOT) || file.endsWith('routes.json')) {
        res.writeHead(404).end();
        return;
      }
      let body: Buffer;
      try {
        body = await readFile(file);
      } catch {
        res.writeHead(404).end();
        return;
      }
      const ext = extname(file);
      const content =
        ext === '.xml' ? body.toString('utf8').replaceAll('{{origin}}', origin) : body;
      res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream' });
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
