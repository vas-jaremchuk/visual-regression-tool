import { expect, test } from '@playwright/test';
import { adminClient, auditEntries, ensureUser, setMembership } from './helpers/admin';
import { signInWithMagicLink } from './helpers/auth';
import { EDITOR, VIEWER } from './fixtures';

/**
 * Review actions (T18, F-REVIEW-1/2/4/5): item review with note and keys, bulk review of the
 * filtered selection, fully reviewed banner and promote to baseline. Seeded per test: 200 changed
 * pages (diff 0.1 % for the first 50, 10 % for the rest) and one unchanged page.
 */
const PROJECT = { slug: 'e2e-review-site', name: 'E2E review site' };
const BEFORE = '2026-11-01_10-00-00';
const AFTER = '2026-11-02_10-00-00';
const CHANGED = 200;
const SMALL = 50;

let projectId = '';
let comparisonId = '';
let afterRunId = '';

async function deleteProject() {
  await adminClient().from('projects').delete().eq('slug', PROJECT.slug);
}

test.beforeEach(async () => {
  await deleteProject();
  const supabase = adminClient();
  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      slug: PROJECT.slug,
      name: PROJECT.name,
      sitemap_index: 'https://www.example.com/sitemap.xml',
      r2_bucket: `vrt-${PROJECT.slug}`,
      r2_public_url: 'https://r2.e2e-review.test',
    })
    .select('id')
    .single();
  if (error) throw error;
  projectId = project.id;
  await setMembership(PROJECT.slug, await ensureUser(VIEWER), 'viewer');
  await setMembership(PROJECT.slug, await ensureUser(EDITOR), 'editor');

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
  afterRunId = runId(AFTER);

  const { data: cmp, error: cmpError } = await supabase
    .from('comparisons')
    .insert({
      project_id: projectId,
      before_run_id: runId(BEFORE),
      after_run_id: afterRunId,
      label: `${BEFORE}_vs_${AFTER}`,
      status: 'completed',
      settings: { changeThresholdPct: 0.05, viewports: ['desktop'] },
    })
    .select('id')
    .single();
  if (cmpError) throw cmpError;
  comparisonId = cmp.id;

  const page = (i: number, status: 'changed' | 'unchanged') => ({
    comparison_id: comparisonId,
    url: `https://www.example.com/page-${i}`,
    name: `page-${i}.png`,
    kind: 'page' as const,
    viewport_slug: 'desktop',
    status,
    diff_pct: status === 'unchanged' ? 0 : i < SMALL ? 0.1 : 10,
  });
  const { error: itemsError } = await supabase
    .from('comparison_items')
    .insert([
      ...Array.from({ length: CHANGED }, (_, i) => page(i, 'changed')),
      page(CHANGED, 'unchanged'),
    ]);
  if (itemsError) throw itemsError;
  const { error: countsError } = await supabase.rpc('refresh_comparison_counts', {
    p_id: comparisonId,
  });
  if (countsError) throw countsError;
});

test.afterAll(deleteProject);

const reportPath = () => `/p/${PROJECT.slug}/comparisons/${comparisonId}`;

async function itemIds(): Promise<string[]> {
  const { data, error } = await adminClient()
    .from('comparison_items')
    .select('id')
    .eq('comparison_id', comparisonId)
    .eq('status', 'changed');
  if (error) throw error;
  return data.map((r) => r.id);
}

test('a viewer sees no review controls and the endpoint refuses them', async ({ page }) => {
  await signInWithMagicLink(page, VIEWER, reportPath());
  await expect(page.getByTestId('item-viewer')).toBeVisible();
  await expect(page.getByTestId('review-progress')).toHaveText(/0\/200 reviewed/);
  await expect(page.getByTestId('review-toolbar')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Bulk review' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Promote/ })).toHaveCount(0);

  // The `a` key does nothing for a viewer.
  await page.keyboard.press('a');
  await expect(page.getByTestId('review-progress')).toHaveText(/0\/200 reviewed/);

  const [first] = await itemIds();
  const res = await page.request.post(`/api/comparisons/${comparisonId}/review`, {
    data: { itemIds: [first], review: 'approved' },
  });
  expect(res.status()).toBe(403);
  const { data } = await adminClient()
    .from('comparison_items')
    .select('review')
    .eq('id', first!)
    .single();
  expect(data?.review).toBe('pending');
});

test('an editor reviews items with the toolbar, a note and the a / r / i keys', async ({
  page,
}) => {
  await signInWithMagicLink(page, EDITOR, reportPath());
  const toolbar = page.getByTestId('review-toolbar');
  const progress = page.getByTestId('review-progress');
  await expect(toolbar).toBeVisible();

  await toolbar.getByLabel('Note (optional)').fill('new hero banner');
  await toolbar.getByRole('button', { name: 'Approve' }).click();
  await expect(toolbar.getByRole('button', { name: 'Approve' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(toolbar).toContainText('“new hero banner”');
  await expect(progress).toHaveText(/1\/200 reviewed · 1 approved/);

  // j moves on; r rejects, i ignores the selected item.
  await toolbar.getByLabel('Note (optional)').blur();
  await page.keyboard.press('j');
  await page.keyboard.press('r');
  await expect(progress).toHaveText(/2\/200 reviewed · 1 approved · 1 rejected/);
  await page.keyboard.press('j');
  await page.keyboard.press('i');
  await expect(progress).toHaveText(/3\/200 reviewed · 1 approved · 1 rejected · 1 ignored/);

  // Reset puts the item back to pending.
  await toolbar.getByRole('button', { name: 'Reset' }).click();
  await expect(progress).toHaveText(/2\/200 reviewed/);

  const entries = await auditEntries('comparison.review', { comparison_id: comparisonId });
  expect(entries).toHaveLength(4);
  expect(entries.some((e) => (e.details as { note?: string }).note === 'new hero banner')).toBe(
    true,
  );
});

test('bulk review of the filtered selection, fully reviewed banner and promote to baseline', async ({
  page,
}) => {
  await signInWithMagicLink(page, EDITOR, reportPath());
  const progress = page.getByTestId('review-progress');

  // Approve all < 0.5 %: the 50 small diffs only.
  await page.getByLabel('Diff < %').fill('0.5');
  await expect(page.getByText(`${SMALL} items`)).toBeVisible();
  await page.getByRole('button', { name: 'Approve all' }).click();
  const started = Date.now();
  await page.getByRole('button', { name: `Approve ${SMALL}` }).click();
  await expect(progress).toHaveText(new RegExp(`${SMALL}/${CHANGED} reviewed`));
  await expect(page.getByRole('status').filter({ hasText: 'Fully reviewed' })).toHaveCount(0);

  // Then ignore everything still pending: 150 items, one request, one audit entry with the ids.
  await page.getByLabel('Diff < %').fill('');
  await page.getByLabel('Review', { exact: true }).selectOption('pending');
  await expect(page.getByText(`${CHANGED - SMALL} items`)).toBeVisible();
  await page.getByRole('button', { name: 'Ignore all' }).click();
  await page.getByRole('button', { name: `Ignore ${CHANGED - SMALL}` }).click();
  await expect(progress).toHaveText(
    new RegExp(`${CHANGED}/${CHANGED} reviewed · ${SMALL} approved · 0 rejected · 150 ignored`),
  );
  expect(Date.now() - started).toBeLessThan(10_000);

  const approved = await auditEntries('comparison.review', {
    comparison_id: comparisonId,
    review: 'approved',
  });
  expect(approved).toHaveLength(1);
  expect((approved[0]!.details as { item_ids: string[] }).item_ids).toHaveLength(SMALL);

  const banner = page.getByRole('status').filter({ hasText: 'Fully reviewed' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: `Promote ${AFTER} to baseline` }).click();
  await expect(banner).toContainText(`${AFTER} is the baseline`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('baseline');
  const { data } = await adminClient()
    .from('projects')
    .select('baseline_run_id')
    .eq('id', projectId)
    .single();
  expect(data?.baseline_run_id).toBe(afterRunId);

  // The comparisons list shows the review progress and the baseline badge.
  await page.goto(`/p/${PROJECT.slug}/comparisons`);
  const row = page.getByRole('row').filter({ hasText: `${BEFORE} → ${AFTER}` });
  await expect(row).toContainText(`${CHANGED}/${CHANGED} reviewed`);
  await expect(row).toContainText('baseline');
  await expect(row.getByRole('progressbar', { name: 'Review progress' })).toHaveAttribute(
    'aria-valuenow',
    String(CHANGED),
  );
});
