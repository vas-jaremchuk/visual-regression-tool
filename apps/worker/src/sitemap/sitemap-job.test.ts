import { encryptSecret, toBase64 } from '@vrt/shared';
import type { IgnoreRule, SnapshotUrl } from '@vrt/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { startFixtureSite, type FixtureSite } from '../test/fixture-site';
import {
  runSitemapJob,
  type SitemapProject,
  type SitemapStore,
  type SnapshotPatch,
  type SnapshotRow,
} from './sitemap-job';

const KEYS = toBase64(new Uint8Array(32).fill(7));
const SNAPSHOT_ID = '6f1c9a52-5d1b-4c8e-9a9e-3b1f2c4d5e6f';
const PROJECT_ID = '0b7f3c2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

function memoryStore(init: {
  sourceUrl: string;
  project?: Partial<SitemapProject>;
  manualUrls?: string[];
  rules?: IgnoreRule[];
}) {
  const snapshot: SnapshotRow & Omit<SnapshotPatch, 'status'> = {
    id: SNAPSHOT_ID,
    projectId: PROJECT_ID,
    status: 'running',
    sourceUrl: init.sourceUrl,
  };
  const urls = new Map<string, SnapshotUrl>();
  const progress: number[] = [];
  const store: SitemapStore = {
    loadSnapshot: async (id) => (id === SNAPSHOT_ID ? { ...snapshot } : null),
    loadProject: async () => ({
      checkRedirects: true,
      basicAuthUser: null,
      basicAuthPassEnc: null,
      fileExtensions: null,
      ...init.project,
    }),
    loadManualUrls: async () => init.manualUrls ?? [],
    loadIgnoreRules: async () => init.rules ?? [],
    updateSnapshot: async (_id, patch) => {
      Object.assign(snapshot, patch);
      if (patch.urls_checked !== undefined) progress.push(patch.urls_checked);
    },
    upsertUrls: async (_id, rows) => {
      for (const row of rows) urls.set(row.url, row);
    },
    listUrls: async (_id, offset = 0, limit = Infinity) =>
      [...urls.values()].sort((a, b) => a.url.localeCompare(b.url)).slice(offset, offset + limit),
  };
  return { store, snapshot, urls, progress };
}

let site: FixtureSite | undefined;
afterEach(async () => {
  await site?.close();
  site = undefined;
});

function deps(store: SitemapStore, allowHosts: string[]) {
  return { store, fetch, ssrf: { allowHosts }, encryptionKeys: KEYS };
}

describe('SitemapWorkflow job against fixtures/site', () => {
  it('fetches an index with 2 children, excludes the redirect, classifies the PDF, keeps the 404', async () => {
    site = await startFixtureSite();
    const origin = site.origin;
    const { store, snapshot, urls, progress } = memoryStore({
      sourceUrl: `${origin}/sitemap.xml`,
      manualUrls: [`${origin}/manual/`, `${origin}/about/`],
    });

    await runSitemapJob(SNAPSHOT_ID, deps(store, [new URL(origin).host]));

    expect(snapshot).toMatchObject({
      status: 'completed',
      child_sitemaps: 2,
      // /, /about/, /blog/post-1/?a=1&b=2, /missing/, /docs/brochure.pdf, /manual/ (manual 404)
      url_count: 6,
      redirect_count: 1,
      error_count: 2,
      urls_total: 7,
      error: null,
    });
    expect(progress.at(-1)).toBe(7);
    expect(urls.size).toBe(7);
    expect(urls.get(`${origin}/old-page/`)).toMatchObject({
      included: false,
      httpStatus: 301,
      redirectTo: `${origin}/about/`,
    });
    expect(urls.get(`${origin}/docs/brochure.pdf`)).toMatchObject({
      kind: 'file',
      included: true,
      httpStatus: 200,
    });
    expect(urls.get(`${origin}/missing/`)).toMatchObject({ included: true, httpStatus: 404 });
    expect(urls.get(`${origin}/blog/post-1/?a=1&b=2`)).toMatchObject({ kind: 'page' });
    expect(urls.get(`${origin}/manual/`)).toMatchObject({ source: 'manual' });
    expect(urls.get(`${origin}/about/`)).toMatchObject({ source: 'sitemap' });
  });

  it('excludes URLs matching url_pattern ignore rules for capture', async () => {
    site = await startFixtureSite();
    const origin = site.origin;
    const { store, snapshot, urls } = memoryStore({
      sourceUrl: `${origin}/sitemap.xml`,
      rules: [
        { type: 'url_pattern', url_pattern: '**/blog/**', applies_to: 'capture', enabled: true },
        { type: 'url_pattern', url_pattern: '**.pdf', applies_to: 'compare', enabled: true },
      ],
    });
    await runSitemapJob(SNAPSHOT_ID, deps(store, [new URL(origin).host]));
    expect(urls.get(`${origin}/blog/post-1/?a=1&b=2`)?.included).toBe(false);
    expect(urls.get(`${origin}/docs/brochure.pdf`)?.included).toBe(true);
    expect(snapshot.url_count).toBe(4);
  });

  it('skips the redirect check when check_redirects is off', async () => {
    site = await startFixtureSite();
    const origin = site.origin;
    const { store, snapshot, urls } = memoryStore({
      sourceUrl: `${origin}/sitemap.xml`,
      project: { checkRedirects: false },
    });
    await runSitemapJob(SNAPSHOT_ID, deps(store, [new URL(origin).host]));
    expect(snapshot).toMatchObject({ status: 'completed', url_count: 6, error_count: 0 });
    expect(urls.get(`${origin}/old-page/`)).toMatchObject({ included: true, httpStatus: null });
    expect(site.requests.some((r) => r.startsWith('HEAD'))).toBe(false);
  });

  it('uses the stored basic auth credentials', async () => {
    site = await startFixtureSite({ basicAuth: { user: 'vrt', pass: 'pässword' } });
    const origin = site.origin;
    const { store, snapshot } = memoryStore({
      sourceUrl: `${origin}/sitemap.xml`,
      project: { basicAuthUser: 'vrt', basicAuthPassEnc: await encryptSecret('pässword', KEYS) },
    });
    await runSitemapJob(SNAPSHOT_ID, deps(store, [new URL(origin).host]));
    expect(snapshot).toMatchObject({ status: 'completed', url_count: 5, error_count: 1 });
  });

  it('fails without credentials on a basic auth site', async () => {
    site = await startFixtureSite({ basicAuth: { user: 'vrt', pass: 'secret' } });
    const { store, snapshot } = memoryStore({ sourceUrl: `${site.origin}/sitemap.xml` });
    await runSitemapJob(SNAPSHOT_ID, deps(store, [new URL(site.origin).host]));
    expect(snapshot).toMatchObject({ status: 'failed', error: 'sitemap index returned HTTP 401' });
  });

  it('rejects a private IP sitemap URL (SSRF guard)', async () => {
    site = await startFixtureSite();
    const { store, snapshot, urls } = memoryStore({ sourceUrl: `${site.origin}/sitemap.xml` });
    await runSitemapJob(SNAPSHOT_ID, deps(store, []));
    expect(snapshot.status).toBe('failed');
    expect(snapshot.error).toMatch(/private address/);
    expect(site.requests).toEqual([]);
    expect(urls.size).toBe(0);
  });

  it('fails when the response is not a sitemap', async () => {
    site = await startFixtureSite();
    const { store, snapshot } = memoryStore({ sourceUrl: `${site.origin}/about/` });
    await runSitemapJob(SNAPSHOT_ID, deps(store, [new URL(site.origin).host]));
    expect(snapshot).toMatchObject({
      status: 'failed',
      error: 'response does not look like a valid sitemap',
    });
  });

  it('records failing child sitemaps without failing the snapshot', async () => {
    site = await startFixtureSite();
    const origin = site.origin;
    const index = `<sitemapindex><sitemap><loc>${origin}/sitemap-pages.xml</loc></sitemap><sitemap><loc>${origin}/gone.xml</loc></sitemap></sitemapindex>`;
    const { store, snapshot } = memoryStore({
      sourceUrl: 'https://index.example.test/sitemap.xml',
    });
    const fetchIndex: typeof fetch = async (input, init) =>
      String(input).startsWith('https://index.example.test')
        ? new Response(index, { status: 200 })
        : fetch(input, init);
    await runSitemapJob(SNAPSHOT_ID, {
      ...deps(store, [new URL(origin).host, 'index.example.test']),
      fetch: fetchIndex,
    });
    expect(snapshot).toMatchObject({ status: 'completed', child_sitemaps: 2 });
    expect(snapshot.error).toMatch(/gone\.xml \(HTTP 404\)/);
  });

  it('does not reopen a snapshot that is no longer running', async () => {
    site = await startFixtureSite();
    const { store, snapshot } = memoryStore({ sourceUrl: `${site.origin}/sitemap.xml` });
    snapshot.status = 'failed';
    await runSitemapJob(SNAPSHOT_ID, deps(store, [new URL(site.origin).host]));
    expect(snapshot.status).toBe('failed');
    expect(site.requests).toEqual([]);
  });
});
