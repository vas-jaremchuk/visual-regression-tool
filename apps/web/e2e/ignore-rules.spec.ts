import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { buildInjectedCss } from '@vrt/engine';
import {
  adminClient,
  auditEntries,
  ensureUser,
  resetAuditWindow,
  setMembership,
} from './helpers/admin';
import { signInWithMagicLink } from './helpers/auth';
import { EDITOR, VIEWER } from './fixtures';

/**
 * Ignore rules (T19, F-IGNORE-1/2/3, F-REVIEW-3): rules page CRUD with enable toggle and pattern
 * tester, item viewer shortcuts (ignore URL, draw a region on the after image) and re-diff with
 * the current rules. The worker is a local stub on `WORKER_URL`; R2 images come from fixtures.
 */
const PROJECT = { slug: 'e2e-ignore-site', name: 'E2E ignore site' };
const PUBLIC_URL = 'https://r2.e2e-ignore.test';
const PAGE_URL = 'https://www.example.com/pricing/';
const BEFORE = '2026-11-01_10-00-00';
const AFTER = '2026-11-02_10-00-00';
const AFTER_PNG = readFileSync(
  fileURLToPath(new URL('../../../fixtures/png/block-change-b.png', import.meta.url)),
);

let worker: Server;
const compareJobs: string[] = [];
let projectId = '';
let comparisonId = '';

test.beforeAll(async () => {
  const port = Number(new URL(process.env.WORKER_URL!).port);
  worker = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/jobs/compare') {
        const { comparisonId: id } = JSON.parse(body) as { comparisonId: string };
        compareJobs.push(id);
        res.end(JSON.stringify({ workflowId: `wf-${id}` }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => worker.listen(port, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => worker.close(resolve));
  await deleteProject();
});

async function deleteProject() {
  await adminClient().from('projects').delete().eq('slug', PROJECT.slug);
}

test.beforeEach(async ({ page }) => {
  resetAuditWindow();
  compareJobs.length = 0;
  await deleteProject();
  const supabase = adminClient();
  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      slug: PROJECT.slug,
      name: PROJECT.name,
      sitemap_index: 'https://www.example.com/sitemap.xml',
      r2_bucket: `vrt-${PROJECT.slug}`,
      r2_public_url: PUBLIC_URL,
    })
    .select('id')
    .single();
  if (error) throw error;
  projectId = project.id;
  await setMembership(PROJECT.slug, await ensureUser(VIEWER), 'viewer');
  await setMembership(PROJECT.slug, await ensureUser(EDITOR), 'editor');
  const { error: vpError } = await supabase.from('viewports').insert([
    { project_id: projectId, slug: 'desktop', width: 1280, height: 800, sort_order: 0 },
    { project_id: projectId, slug: 'mobile', width: 390, height: 844, sort_order: 1 },
  ]);
  if (vpError) throw vpError;

  const { data: runs, error: runsError } = await supabase
    .from('runs')
    .insert(
      [BEFORE, AFTER].map((label) => ({
        project_id: projectId,
        label,
        status: 'completed' as const,
        created_at: `${label.slice(0, 10)}T10:00:00Z`,
      })),
    )
    .select('id, label');
  if (runsError) throw runsError;
  const runId = (label: string) => runs.find((r) => r.label === label)!.id;
  const { data: cmp, error: cmpError } = await supabase
    .from('comparisons')
    .insert({
      project_id: projectId,
      before_run_id: runId(BEFORE),
      after_run_id: runId(AFTER),
      label: `${BEFORE}_vs_${AFTER}`,
      status: 'completed',
      settings: { changeThresholdPct: 0.05, viewports: ['desktop'], ignoreRules: [] },
    })
    .select('id')
    .single();
  if (cmpError) throw cmpError;
  comparisonId = cmp.id;
  const { error: itemError } = await supabase.from('comparison_items').insert({
    comparison_id: comparisonId,
    url: PAGE_URL,
    name: 'pricing',
    kind: 'page',
    viewport_slug: 'desktop',
    status: 'changed',
    diff_pct: 8.33,
    before_key: `screenshots/${BEFORE}/desktop/pricing.png`,
    after_key: `screenshots/${AFTER}/desktop/pricing.png`,
    diff_key: `diffs/${BEFORE}_vs_${AFTER}/desktop/pricing.png`,
  });
  if (itemError) throw itemError;
  await supabase.rpc('refresh_comparison_counts', { p_id: comparisonId });

  // Every R2 image is the after screenshot of the block-change fixture (64×48 px).
  await page.route(`${PUBLIC_URL}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: AFTER_PNG }),
  );
});

async function rules() {
  const { data, error } = await adminClient()
    .from('ignore_rules')
    .select('type, url_pattern, selector, region, viewport_slug, applies_to, enabled, reason')
    .eq('project_id', projectId)
    .order('created_at');
  if (error) throw error;
  return data;
}

const rulesPath = `/p/${PROJECT.slug}/ignore-rules`;

test('an editor creates, tests, disables, edits and deletes rules', async ({ page }) => {
  await signInWithMagicLink(page, EDITOR, rulesPath);
  await expect(page.getByRole('heading', { name: 'Ignore rules' })).toBeVisible();
  await expect(page.getByRole('main').getByText('No ignore rules.')).toBeVisible();

  await page.getByRole('button', { name: 'Add rule' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('URL pattern').fill('https://www.example.com/blog/**');
  await dialog.getByLabel('Applies to').selectOption('capture');
  await dialog.getByLabel('Reason (optional)').fill('blog is out of scope');
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await expect(page.getByTestId('ignore-rule-row')).toHaveCount(1);

  await page.getByRole('button', { name: 'Add rule' }).click();
  await dialog.getByLabel('Type').selectOption('selector');
  await dialog.getByLabel('CSS selector').fill('#live-chat');
  await dialog.getByLabel('Viewport').selectOption('mobile');
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await expect(page.getByTestId('ignore-rule-row')).toHaveCount(2);

  expect(await rules()).toEqual([
    expect.objectContaining({
      type: 'url_pattern',
      url_pattern: 'https://www.example.com/blog/**',
      applies_to: 'capture',
      reason: 'blog is out of scope',
      enabled: true,
    }),
    expect.objectContaining({
      type: 'selector',
      selector: '#live-chat',
      url_pattern: null,
      viewport_slug: 'mobile',
    }),
  ]);

  // Pattern tester (F-IGNORE-2).
  const result = page.getByTestId('tester-result');
  await page.getByLabel('URL', { exact: true }).fill('https://www.example.com/blog/2026/post');
  await expect(result).toContainText('https://www.example.com/blog/**');
  await expect(result).toContainText('#live-chat');
  await page.getByLabel('Viewport', { exact: true }).selectOption('desktop');
  await expect(result).not.toContainText('#live-chat');
  await page.getByLabel('URL', { exact: true }).fill('https://www.example.com/about');
  await expect(result).toHaveText('No rule matches this URL.');

  // Toggle, edit, delete.
  await page.getByLabel('Enable rule #live-chat').uncheck();
  await expect.poll(async () => (await rules())[1]?.enabled).toBe(false);
  await page.getByRole('button', { name: 'Edit rule https://www.example.com/blog/**' }).click();
  await dialog.getByLabel('URL pattern').fill('re:/blog/');
  await dialog.getByRole('button', { name: 'Save rule' }).click();
  await expect.poll(async () => (await rules())[0]?.url_pattern).toBe('re:/blog/');
  await page.getByRole('button', { name: 'Delete rule #live-chat' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete rule' }).click();
  await expect(page.getByTestId('ignore-rule-row')).toHaveCount(1);

  for (const action of ['ignore_rule.create', 'ignore_rule.update', 'ignore_rule.delete']) {
    expect(await auditEntries(action, {}), action).not.toHaveLength(0);
  }
});

test('a viewer sees the rules and the tester but cannot change them', async ({ page }) => {
  await adminClient().from('ignore_rules').insert({
    project_id: projectId,
    type: 'url_pattern',
    url_pattern: 'https://www.example.com/cart',
  });
  await signInWithMagicLink(page, VIEWER, rulesPath);
  // Scoped to main: while the page streams in, a hidden copy can exist outside it.
  const main = page.getByRole('main');
  await expect(main.getByTestId('ignore-rule-row')).toHaveCount(1);
  await expect(main.getByRole('button', { name: 'Add rule' })).toHaveCount(0);
  await expect(main.getByRole('button', { name: /Delete rule/ })).toHaveCount(0);
  await main.getByLabel('URL', { exact: true }).fill('https://www.example.com/cart');
  await expect(main.getByTestId('tester-result')).toContainText('https://www.example.com/cart');

  const report = `/p/${PROJECT.slug}/comparisons/${comparisonId}`;
  await page.goto(report);
  // While the page streams in, the viewer can briefly render twice.
  await expect(page.getByTestId('item-viewer').first()).toBeVisible();
  await expect(page.getByRole('group', { name: 'Ignore rule shortcuts' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Re-diff' })).toHaveCount(0);
  const res = await page.request.post(`/api/comparisons/${comparisonId}/rediff`, { data: {} });
  expect(res.status()).toBe(403);
});

test('item viewer shortcuts create URL and region rules, re-diff applies them', async ({
  page,
}) => {
  await signInWithMagicLink(page, EDITOR, `/p/${PROJECT.slug}/comparisons/${comparisonId}`);
  const shortcuts = page.getByRole('group', { name: 'Ignore rule shortcuts' });
  await expect(shortcuts).toBeVisible();
  const dialog = page.getByRole('dialog');

  // Ignore this URL: prefilled with the exact URL.
  await shortcuts.getByRole('button', { name: 'Ignore this URL' }).click();
  await expect(dialog.getByLabel('URL pattern')).toHaveValue(PAGE_URL);
  await dialog.getByLabel('Applies to').selectOption('compare');
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await expect(dialog).toHaveCount(0);

  // Ignore region: drag on the after image; coordinates are image pixels whatever the zoom.
  await shortcuts.getByRole('button', { name: 'Ignore region' }).click();
  await expect(dialog.getByLabel('URL pattern (optional, empty = every URL)')).toHaveValue(
    PAGE_URL,
  );
  await expect(dialog.getByLabel('Viewport')).toHaveValue('desktop');
  const canvas = dialog.getByTestId('region-canvas');
  const img = canvas.getByRole('img');
  await expect(img).toHaveJSProperty('naturalWidth', 64);
  const box = (await img.boundingBox())!;
  const at = (x: number, y: number) =>
    [box.x + (x / 64) * box.width, box.y + (y / 48) * box.height] as const;
  await page.mouse.move(...at(40.2, 20.2));
  await page.mouse.down();
  await page.mouse.move(...at(50, 30), { steps: 4 });
  await page.mouse.move(...at(56.2, 36.2), { steps: 4 });
  await page.mouse.up();
  await expect(dialog.getByTestId('region-box')).toBeVisible();
  await expect(dialog.getByLabel('x (px)')).toHaveValue('40');
  await expect(dialog.getByLabel('y (px)')).toHaveValue('20');
  await expect(dialog.getByLabel('width (px)')).toHaveValue('16');
  await expect(dialog.getByLabel('height (px)')).toHaveValue('16');
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await expect(dialog).toHaveCount(0);

  expect(await rules()).toEqual([
    expect.objectContaining({ type: 'url_pattern', url_pattern: PAGE_URL, applies_to: 'compare' }),
    expect.objectContaining({
      type: 'region',
      url_pattern: PAGE_URL,
      viewport_slug: 'desktop',
      region: { x: 40, y: 20, width: 16, height: 16 },
      applies_to: 'both',
    }),
  ]);

  // Re-diff: the comparison is queued again and the compare workflow started.
  await page.getByRole('button', { name: 'Re-diff' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Re-diff' }).click();
  await expect(page.getByText('Re-diff started')).toBeVisible();
  expect(compareJobs).toEqual([comparisonId]);
  const { data: cmp } = await adminClient()
    .from('comparisons')
    .select('status, workflow_id')
    .eq('id', comparisonId)
    .single();
  expect(cmp).toEqual({ status: 'queued', workflow_id: `wf-${comparisonId}` });
  expect(await auditEntries('comparison.rediff', { comparisonId })).toHaveLength(1);

  // While it runs, a second re-diff is refused.
  const res = await page.request.post(`/api/comparisons/${comparisonId}/rediff`, { data: {} });
  expect(res.status()).toBe(409);
});

test('a selector rule hides its element in the capture CSS', async ({ page }) => {
  // The CSS the capture consumer injects (05 §4 step 3) for an enabled selector rule.
  const css = buildInjectedCss(
    { extra_css: null, hide_selectors: null },
    [
      { type: 'selector', selector: '#live-chat' },
      { type: 'selector', selector: '.promo', viewport_slug: 'mobile' },
    ],
    PAGE_URL,
    'desktop',
  );
  await page.setContent(
    '<h1>Pricing</h1><div id="live-chat">Chat with us</div><div class="promo">Sale</div>',
  );
  await expect(page.locator('#live-chat')).toBeVisible();
  await page.addStyleTag({ content: css });
  await expect(page.locator('#live-chat')).toBeHidden();
  await expect(page.locator('h1')).toBeVisible();
  // Scoped to another viewport: not hidden on desktop.
  await expect(page.locator('.promo')).toBeVisible();
});
