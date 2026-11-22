import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { experimental_readRawConfig } from 'wrangler';
import { describe, expect, it } from 'vitest';
import { handleFixtureRequest, VERSION_PATH } from './worker';

const ROOT = fileURLToPath(new URL('../../../../fixtures/site', import.meta.url).href);
const ORIGIN = 'https://vrt-fixture-site.example.workers.dev';

/** Stands in for the Workers static assets binding: serves `fixtures/site/` by exact path. */
const ASSETS = {
  fetch: async (input: URL) => {
    try {
      return new Response(await readFile(ROOT + new URL(input).pathname));
    } catch {
      return new Response(null, { status: 404 });
    }
  },
} as unknown as Fetcher;

function get(path: string, version?: string, method = 'GET') {
  return handleFixtureRequest(new Request(ORIGIN + path, { method }), {
    ASSETS,
    SITE_VERSION: version,
  });
}

describe('fixture site Worker', () => {
  it('serves v1 by default and reports the version', async () => {
    expect(await (await get(VERSION_PATH)).json()).toEqual({ version: 'v1' });
    const home = await get('/');
    expect(home.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await home.text()).toContain('<h1>Fixture page home</h1>');
    expect((await get('/blog/post-1/?a=1&b=2')).status).toBe(200);
    expect((await get('/contact/')).status).toBe(404);
  });

  it('serves v2 under the same URLs: changed heading, image and PDF, added and removed page', async () => {
    expect(await (await get(VERSION_PATH, 'v2')).json()).toEqual({ version: 'v2' });
    expect(await (await get('/', 'v2')).text()).toContain('<h1>Fixture page home, version 2</h1>');
    const [image1, image2] = await Promise.all([get('/img/team.svg'), get('/img/team.svg', 'v2')]);
    expect(image2.headers.get('content-type')).toBe('image/svg+xml');
    expect(await image2.text()).not.toBe(await image1.text());
    const [pdf1, pdf2] = await Promise.all([
      get('/docs/brochure.pdf'),
      get('/docs/brochure.pdf', 'v2'),
    ]);
    expect(pdf2.headers.get('content-type')).toBe('application/pdf');
    expect(await pdf2.text()).not.toBe(await pdf1.text());
    expect((await get('/contact/', 'v2')).status).toBe(200);
    expect((await get('/blog/post-1/', 'v2')).status).toBe(404);
  });

  it('fills in its own origin in sitemaps', async () => {
    const pages = await (await get('/sitemap-pages.xml', 'v2')).text();
    expect(pages).toContain(`<loc>${ORIGIN}/contact/</loc>`);
    expect(pages).not.toContain('{{origin}}');
    expect(await (await get('/sitemap.xml')).text()).toContain(`${ORIGIN}/sitemap-files.xml`);
  });

  it('redirects, 404s, hides routes.json and other versions', async () => {
    const redirect = await get('/old-page/', 'v2');
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('location')).toBe('/about/');
    for (const path of ['/missing/', '/routes.json', '/v2/', '/v2/contact/', '/../package.json']) {
      expect((await get(path)).status, path).toBe(404);
    }
  });

  it('answers HEAD without a body and refuses other methods', async () => {
    const head = await get('/docs/brochure.pdf', 'v1', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect((await get('/', 'v1', 'POST')).status).toBe(405);
  });

  it('rejects an unknown SITE_VERSION', async () => {
    await expect(get('/', 'v3')).rejects.toThrow(/SITE_VERSION must be v1 or v2/);
  });
});

describe('wrangler.fixture-site.jsonc', () => {
  const { rawConfig: config } = experimental_readRawConfig({
    config: fileURLToPath(new URL('../../wrangler.fixture-site.jsonc', import.meta.url).href),
  });

  it('uploads fixtures/site as assets behind the Worker, starting at v1', () => {
    expect(config.main).toBe('src/fixture-site/worker.ts');
    expect(config.assets).toMatchObject({
      directory: '../../fixtures/site',
      binding: 'ASSETS',
      run_worker_first: true,
      html_handling: 'none',
    });
    expect(config.vars).toEqual({ SITE_VERSION: 'v1' });
  });
});
