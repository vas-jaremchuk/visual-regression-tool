import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { Json } from '@vrt/db';
import { adminClient, ensureUser, setMembership } from './helpers/admin';
import { signInWithMagicLink } from './helpers/auth';
import { VIEWER } from './fixtures';

/**
 * Report page and item viewer (T16) on seeded data: 1 000 changed items, files, redirected, new
 * and missing pages. Images come from the project's public URL, served from fixtures/png.
 */
const PROJECT = { slug: 'e2e-report-site', name: 'E2E report site' };
const OTHER = { slug: 'e2e-report-other', name: 'E2E report other' };
const PUBLIC_URL = 'https://r2.e2e-report.test';
const BEFORE = '2026-11-01_10-00-00';
const AFTER = '2026-11-02_10-00-00';
const LATER = '2026-11-03_10-00-00';
const OTHER_BEFORE = '2026-10-01_10-00-00';
const OTHER_AFTER = '2026-10-02_10-00-00';
const CMP_LABEL = `${BEFORE}_vs_${AFTER}`;
const CHANGED = 1000;

const png = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../fixtures/png/${name}`, import.meta.url)));
const IMAGES = {
  before: png('block-change-a.png'),
  after: png('block-change-b.png'),
  diff: png('one-pixel-b.png'),
};

let comparisonId = '';
let emptyComparisonId = '';
let otherComparisonId = '';
let topItemId = '';

async function deleteProjects() {
  await adminClient().from('projects').delete().in('slug', [PROJECT.slug, OTHER.slug]);
}

async function insertProject(slug: string, name: string, publicUrl: string | null) {
  const { data, error } = await adminClient()
    .from('projects')
    .insert({
      slug,
      name,
      sitemap_index: 'https://www.example.com/sitemap.xml',
      r2_bucket: `vrt-${slug}`,
      r2_public_url: publicUrl,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function insertRuns(projectId: string, labels: string[]) {
  const { data, error } = await adminClient()
    .from('runs')
    .insert(
      labels.map((label) => ({
        project_id: projectId,
        label,
        status: 'completed' as const,
        created_at: `${label.slice(0, 10)}T10:00:00Z`,
      })),
    )
    .select('id, label');
  if (error) throw error;
  return (label: string) => data.find((r) => r.label === label)!.id;
}

/** Diff % of changed item `i`: distinct, spread over 0.06..99.9 so every severity band appears. */
function pctOf(i: number) {
  return Number((99.9 - (i * 99.84) / (CHANGED - 1)).toFixed(4));
}

test.beforeAll(async () => {
  test.setTimeout(60_000);
  await deleteProjects();
  const supabase = adminClient();
  const projectId = await insertProject(PROJECT.slug, PROJECT.name, PUBLIC_URL);
  await setMembership(PROJECT.slug, await ensureUser(VIEWER), 'viewer');
  const run = await insertRuns(projectId, [BEFORE, AFTER, LATER]);

  const insertComparison = async (
    project: string,
    before: string,
    after: string,
    beforeId: string,
    afterId: string,
    counts: NonNullable<Json>,
  ) => {
    const { data, error } = await supabase
      .from('comparisons')
      .insert({
        project_id: project,
        before_run_id: beforeId,
        after_run_id: afterId,
        label: `${before}_vs_${after}`,
        status: 'completed',
        settings: { changeThresholdPct: 0.05, viewports: ['desktop', 'mobile'] },
        counts,
        review_counts: { pending: CHANGED, approved: 0, rejected: 0, ignored: 0 },
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  };

  comparisonId = await insertComparison(projectId, BEFORE, AFTER, run(BEFORE), run(AFTER), {
    compared: CHANGED + 2,
    changed: CHANGED,
    unchanged: 2,
    new: 1,
    missing: 1,
    redirect: 1,
    error: 0,
    files_changed: 1,
    files_total: 2,
    viewports: {
      desktop: {
        compared: CHANGED / 2 + 1,
        changed: CHANGED / 2,
        unchanged: 1,
        new: 1,
        missing: 1,
        redirect: 1,
        error: 0,
      },
      mobile: {
        compared: CHANGED / 2 + 1,
        changed: CHANGED / 2,
        unchanged: 1,
        new: 0,
        missing: 0,
        redirect: 0,
        error: 0,
      },
    },
  });

  const page = (i: number, viewport: string, status: 'changed' | 'unchanged') => {
    const path = `page-${i}`;
    return {
      comparison_id: comparisonId,
      url: `https://www.example.com/${path}`,
      name: `${path}.png`,
      kind: 'page' as const,
      viewport_slug: viewport,
      status,
      diff_pct: status === 'changed' ? pctOf(i) : 0,
      diff_pixels: status === 'changed' ? Math.round(pctOf(i) * 30.72) : 0,
      total_pixels: 3072,
      before_key: `screenshots/${BEFORE}/${viewport}/${path}.png`,
      after_key: `screenshots/${AFTER}/${viewport}/${path}.png`,
      diff_key: `diffs/${CMP_LABEL}/${viewport}/${path}.png`,
      before_dims: [64, 48],
      after_dims: [64, 48],
    };
  };
  const items = [
    ...Array.from({ length: CHANGED }, (_, i) =>
      page(i, i % 2 === 0 ? 'desktop' : 'mobile', 'changed'),
    ),
    page(CHANGED, 'desktop', 'unchanged'),
    page(CHANGED + 1, 'mobile', 'unchanged'),
    {
      comparison_id: comparisonId,
      url: 'https://www.example.com/brand-new',
      name: 'brand-new.png',
      kind: 'page' as const,
      viewport_slug: 'desktop',
      status: 'new' as const,
      after_key: `screenshots/${AFTER}/desktop/brand-new.png`,
    },
    {
      comparison_id: comparisonId,
      url: 'https://www.example.com/gone',
      name: 'gone.png',
      kind: 'page' as const,
      viewport_slug: 'desktop',
      status: 'missing' as const,
      before_key: `screenshots/${BEFORE}/desktop/gone.png`,
    },
    {
      comparison_id: comparisonId,
      url: 'https://www.example.com/old-path',
      name: 'old-path.png',
      kind: 'page' as const,
      viewport_slug: 'desktop',
      status: 'redirect' as const,
      redirect_to: 'https://www.example.com/new-path',
    },
    {
      comparison_id: comparisonId,
      url: 'https://www.example.com/files/price-list.pdf',
      name: 'files_price-list.pdf.png',
      kind: 'file' as const,
      status: 'changed' as const,
      fp_before: { sha256: 'a'.repeat(64), size: 1200 },
      fp_after: { sha256: 'b'.repeat(64), size: 1300 },
    },
    {
      comparison_id: comparisonId,
      url: 'https://www.example.com/files/terms.pdf',
      name: 'files_terms.pdf.png',
      kind: 'file' as const,
      status: 'unchanged' as const,
      fp_before: { sha256: 'c'.repeat(64), size: 900 },
      fp_after: { sha256: 'c'.repeat(64), size: 900 },
    },
  ];
  const { error } = await supabase.from('comparison_items').insert(items);
  if (error) throw error;
  const { data: top, error: topError } = await supabase
    .from('comparison_items')
    .select('id')
    .eq('comparison_id', comparisonId)
    .eq('url', 'https://www.example.com/page-0')
    .single();
  if (topError) throw topError;
  topItemId = top.id;

  emptyComparisonId = await insertComparison(projectId, AFTER, LATER, run(AFTER), run(LATER), {
    compared: 1,
    changed: 0,
    unchanged: 1,
    new: 0,
    missing: 0,
    redirect: 0,
    error: 0,
    files_changed: 0,
    files_total: 0,
  });

  // A project the viewer is not a member of.
  const otherId = await insertProject(OTHER.slug, OTHER.name, null);
  const otherRun = await insertRuns(otherId, [OTHER_BEFORE, OTHER_AFTER]);
  otherComparisonId = await insertComparison(
    otherId,
    OTHER_BEFORE,
    OTHER_AFTER,
    otherRun(OTHER_BEFORE),
    otherRun(OTHER_AFTER),
    {},
  );
});

test.afterAll(deleteProjects);

/** Serves report images from fixtures/png in place of the R2 public URL. */
async function serveImages(page: Page) {
  await page.route(`${PUBLIC_URL}/**`, (route) => {
    const key = new URL(route.request().url()).pathname.slice(1);
    const body = key.startsWith('diffs/')
      ? IMAGES.diff
      : key.startsWith(`screenshots/${BEFORE}/`)
        ? IMAGES.before
        : IMAGES.after;
    return route.fulfill({ status: 200, contentType: 'image/png', body });
  });
}

const reportPath = () => `/p/${PROJECT.slug}/comparisons/${comparisonId}`;

test('1 000-item report renders within the NFR-4 budget with a virtualised list', async ({
  page,
}) => {
  await serveImages(page);
  await signInWithMagicLink(page, VIEWER, reportPath());
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${BEFORE} ↔ ${AFTER}`);

  // Measure a fresh navigation now that the session cookie is set.
  await page.goto(reportPath());
  const list = page.getByTestId('item-list');
  await expect(list.getByRole('option').first()).toBeVisible();
  const fcp = await page.evaluate(
    () => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? Infinity,
  );
  expect(fcp).toBeLessThanOrEqual(2_000);

  await expect(page.getByRole('button', { name: `${CHANGED} changed` })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText(`${CHANGED} items`)).toBeVisible();
  // Sorted by diff % desc; only a window of rows is in the DOM.
  await expect(list.getByRole('option').first()).toContainText('/page-0');
  await expect(list.getByRole('option').first().locator('[data-severity]')).toHaveAttribute(
    'data-severity',
    'high',
  );
  expect(await list.getByRole('option').count()).toBeLessThan(60);

  // Scrolling to the end pages in the rest, 100 at a time.
  await expect(async () => {
    await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(list.getByRole('option').last()).toContainText(`/page-${CHANGED - 1}`, {
      timeout: 1_000,
    });
  }).toPass({ timeout: 20_000 });
  await expect(list.getByRole('option').last().locator('[data-severity]')).toHaveAttribute(
    'data-severity',
    'low',
  );
  expect(await list.getByRole('option').count()).toBeLessThan(60);

  // Sections below the list.
  await expect(page.getByRole('heading', { name: 'Files, fingerprint check (2)' })).toBeVisible();
  await expect(page.getByText('1 file(s) have a different fingerprint')).toBeVisible();
  await expect(page.getByText('a'.repeat(64))).toBeVisible();
  await expect(page.getByRole('heading', { name: /Redirected pages/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'https://www.example.com/new-path' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New pages (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Missing pages (1)' })).toBeVisible();
});

test('chips, viewport tabs and filters narrow the list', async ({ page }) => {
  await signInWithMagicLink(page, VIEWER, reportPath());
  const list = page.getByTestId('item-list');

  await page.getByRole('tab', { name: 'mobile' }).click();
  await expect(page.getByRole('button', { name: `${CHANGED / 2} changed` })).toBeVisible();
  await expect(page.getByText(`${CHANGED / 2} items`)).toBeVisible();
  await expect(list.getByRole('option').first()).toContainText('/page-1');

  await page.getByRole('tab', { name: 'All' }).click();
  await page.getByRole('button', { name: '1 new' }).click();
  await expect(page.getByText('1 item', { exact: true })).toBeVisible();
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list).toContainText('/brand-new');

  await page.getByRole('button', { name: `${CHANGED} changed` }).click();
  await page.getByLabel('Search URL').fill('page-99');
  // page-99, page-990..999
  await expect(page.getByText('11 items')).toBeVisible();

  await page.getByLabel('Review').selectOption('rejected');
  await expect(page.getByText('No items match these filters.')).toBeVisible();
});

test('empty state uses the prototype wording', async ({ page }) => {
  await signInWithMagicLink(page, VIEWER, `/p/${PROJECT.slug}/comparisons/${emptyComparisonId}`);
  await expect(
    page
      .getByRole('main')
      .getByText('✅ No visual differences detected above the 0.05% threshold.'),
  ).toBeVisible();
});

test('item viewer: four modes, deep link and keyboard navigation', async ({ page }, testInfo) => {
  await serveImages(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInWithMagicLink(page, VIEWER, `${reportPath()}/items/${topItemId}`);
  const viewer = page.getByTestId('item-viewer');
  await expect(viewer.getByRole('heading', { level: 2 })).toHaveText('/page-0');

  const loaded = async (alt: string) => {
    const img = viewer.getByAltText(alt, { exact: true });
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(64);
  };
  const shoot = async (name: string) =>
    testInfo.attach(name, { body: await viewer.screenshot(), contentType: 'image/png' });

  // 1: side by side (before / diff / after)
  await expect(viewer.getByRole('button', { name: 'Side by side' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await loaded('before /page-0');
  await loaded('diff /page-0');
  await loaded('after /page-0');
  await shoot('mode-side-by-side.png');

  // 2: slider
  await page.keyboard.press('2');
  await expect(viewer.getByRole('button', { name: 'Slider' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await loaded('after /page-0');
  await viewer.getByLabel('Reveal before').fill('25');
  await expect(viewer.getByTestId('slider-before')).toHaveAttribute(
    'style',
    /clip-path: inset\(0px 75% 0px 0px\)|clip-path: inset\(0 75% 0 0\)/,
  );
  await shoot('mode-slider.png');

  // 3: overlay
  await page.keyboard.press('3');
  await expect(viewer.getByRole('button', { name: 'Overlay' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await viewer.getByLabel('Before opacity').fill('30');
  await expect(viewer.getByTestId('overlay-before')).toHaveAttribute('style', /opacity: 0.3/);
  await loaded('before /page-0');
  await shoot('mode-overlay.png');

  // 4: diff only
  await page.keyboard.press('4');
  await expect(viewer.getByRole('button', { name: 'Diff only' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await loaded('diff /page-0');
  await expect(viewer.getByAltText('before /page-0')).toHaveCount(0);
  await shoot('mode-diff-only.png');

  // Zoom 100 %: images keep their natural width.
  await viewer.getByRole('button', { name: '100 %' }).click();
  await expect
    .poll(() =>
      viewer.getByAltText('diff /page-0').evaluate((el) => el.getBoundingClientRect().width),
    )
    .toBe(64);

  // j/k move through the list and keep the URL deep-linkable.
  await page.keyboard.press('j');
  await expect(viewer.getByRole('heading', { level: 2 })).toHaveText('/page-1');
  await expect(page).toHaveURL(/\/items\/[0-9a-f-]{36}$/);
  const deepLink = page.url();
  await page.keyboard.press('k');
  await expect(viewer.getByRole('heading', { level: 2 })).toHaveText('/page-0');
  await page.goto(deepLink);
  await expect(viewer.getByRole('heading', { level: 2 })).toHaveText('/page-1');
});

test('signed URL endpoint signs this comparison only', async ({ page }) => {
  await signInWithMagicLink(page, VIEWER, reportPath());
  const sign = (comparison: string, key: string) =>
    page.request.get(`/api/r2/sign?${new URLSearchParams({ comparison, key })}`, {
      maxRedirects: 0,
    });

  const own = await sign(comparisonId, `screenshots/${BEFORE}/desktop/page-0.png`);
  expect(own.status()).toBe(200);
  const body = (await own.json()) as { url: string };
  const signed = new URL(body.url);
  expect(signed.pathname).toBe(`/vrt-${PROJECT.slug}/screenshots/${BEFORE}/desktop/page-0.png`);
  expect(signed.searchParams.get('X-Amz-Expires')).toBe('3600');
  expect(signed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);

  const redirect = await page.request.get(
    `/api/r2/sign?${new URLSearchParams({ comparison: comparisonId, key: `diffs/${CMP_LABEL}/desktop/page-0.png`, redirect: '1' })}`,
    { maxRedirects: 0 },
  );
  expect(redirect.status()).toBe(302);
  expect(redirect.headers()['location']).toContain('X-Amz-Signature=');

  // A key of the other project's runs, through a comparison the viewer can see.
  const foreignKey = await sign(comparisonId, `screenshots/${OTHER_BEFORE}/desktop/home.png`);
  expect(foreignKey.status()).toBe(403);
  // The other project's comparison is not visible to the viewer.
  const foreignComparison = await sign(
    otherComparisonId,
    `screenshots/${OTHER_BEFORE}/desktop/home.png`,
  );
  expect(foreignComparison.status()).toBe(404);
  // Path escapes.
  const escape = await sign(
    comparisonId,
    `screenshots/${BEFORE}/../${OTHER_BEFORE}/desktop/home.png`,
  );
  expect(escape.status()).toBe(403);
});
