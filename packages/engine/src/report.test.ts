import { describe, expect, it } from 'vitest';
import { escapeHtml, renderStaticReport, type ReportComparison, type ReportItem } from './report';

const comparison: ReportComparison = {
  label: '2026-11-18_09-00-00_vs_2026-11-19_09-00-00',
  project_name: 'Example <Site>',
  before_label: '2026-11-18_09-00-00',
  after_label: '2026-11-19_09-00-00',
  change_threshold_pct: 0.05,
};
const opts = {
  publicUrl: 'https://pub.example.com/',
  generatedAt: new Date('2026-11-19T10:11:12Z'),
};
const keys = (vp: string, f: string) => ({
  before_key: `screenshots/${comparison.before_label}/${vp}/${f}`,
  after_key: `screenshots/${comparison.after_label}/${vp}/${f}`,
  diff_key: `diffs/${comparison.label}/${vp}/${f}`,
});

const items: ReportItem[] = [
  { url: 'https://example.com/small', name: 'small', kind: 'page', viewport_slug: 'desktop', status: 'changed', diff_pct: 0.5, diff_pixels: 5760, total_pixels: 1152000, review: 'approved', ...keys('desktop', 'small.png') },
  { url: 'https://example.com/big', name: 'big', kind: 'page', viewport_slug: 'mobile', status: 'changed', diff_pct: 12.5, diff_pixels: 41000, total_pixels: 328000, ...keys('mobile', 'big.png') },
  { url: 'https://example.com/mid', name: 'mid', kind: 'page', viewport_slug: 'desktop', status: 'changed', diff_pct: 2, diff_pixels: 23040, total_pixels: 1152000, review: 'rejected', ...keys('desktop', 'mid.png') },
  { url: 'https://example.com/same', name: 'same', kind: 'page', viewport_slug: 'desktop', status: 'unchanged', diff_pct: 0 },
  { url: 'https://example.com/new', name: 'new', kind: 'page', viewport_slug: 'desktop', status: 'new' },
  { url: null, name: 'legacy_missing', kind: 'page', viewport_slug: 'desktop', status: 'missing' },
  { url: 'https://example.com/old', name: 'old', kind: 'page', viewport_slug: 'desktop', status: 'redirect', redirect_to: 'https://example.com/new?a=1&b=2' },
  { url: 'https://example.com/broken', name: 'broken', kind: 'page', viewport_slug: 'desktop', status: 'error', error: 'Navigation timeout of 30000 ms exceeded' },
  { url: 'https://example.com/r.pdf', name: 'r.pdf', kind: 'file', viewport_slug: null, status: 'changed', fp_before: { sha256: 'aaa', size: 10 }, fp_after: { sha256: 'bbb', size: 12 }, review: 'ignored' },
  { url: 'https://example.com/s.pdf', name: 's.pdf', kind: 'file', viewport_slug: null, status: 'unchanged', fp_before: { sha256: 'ccc', size: 1 }, fp_after: { sha256: 'ccc', size: 1 } },
  { url: 'https://example.com/n.pdf', name: 'n.pdf', kind: 'file', viewport_slug: null, status: 'new' },
  { url: 'https://example.com/m.pdf', name: 'm.pdf', kind: 'file', viewport_slug: null, status: 'missing' },
]; // prettier-ignore

describe('renderStaticReport', () => {
  it('matches the snapshot', async () => {
    await expect(renderStaticReport(comparison, items, opts)).toMatchFileSnapshot(
      './__snapshots__/report.html',
    );
  });

  it('sorts changed pages by pct desc and uses absolute image URLs', () => {
    const html = renderStaticReport(comparison, items, opts);
    const order = ['/big"', '/mid"', '/small"'].map((s) => html.indexOf(`https://example.com${s}`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain(
      `src="https://pub.example.com/diffs/${comparison.label}/mobile/big.png"`,
    );
    expect(html).toContain('<span class="badge review-approved">approved</span>');
    expect(html).toContain('<span class="badge review-pending">pending</span>');
    expect(html).toContain('📄 4 compared');
    expect(html).toContain('📎 1 / 4 files changed');
  });

  it('escapes a URL containing <script>', () => {
    const evil = 'https://example.com/"><script>alert(1)</script>';
    const html = renderStaticReport(
      { ...comparison, project_name: '<script>x</script>' },
      [
        { url: evil, name: 'evil', kind: 'page', viewport_slug: 'desktop', status: 'changed', diff_pct: 1, diff_pixels: 1, total_pixels: 100, before_key: 'k"><script>', after_key: null, diff_key: null },
        { url: evil, name: 'evil2', kind: 'page', viewport_slug: '<b>', status: 'redirect', redirect_to: evil },
        { url: evil, name: 'evil3', kind: 'file', viewport_slug: null, status: 'changed', fp_before: { sha256: '<i>' }, fp_after: null },
        { url: null, name: '<img src=x>', kind: 'page', viewport_slug: null, status: 'error', error: '<svg onload=1>' },
      ], // prettier-ignore
      opts,
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('<img src=x>');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('shows the no-changes banner and no file section when there is nothing to report', () => {
    const html = renderStaticReport(comparison, [items[3]!], {
      publicUrl: 'https://pub.example.com',
    });
    expect(html).toContain('No visual differences detected above the 0.05% threshold.');
    expect(html).not.toContain('class="files"');
    expect(html).not.toContain('class="extras"');
    expect(html).toMatch(/<strong>Generated:<\/strong> \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC/);
  });

  it('builds image URLs with imageUrl when given, escaped', () => {
    const html = renderStaticReport(comparison, items, {
      ...opts,
      imageUrl: (key) => `https://r2.example.com/b/${key}?X-Amz-Signature=a&b=1`,
    });
    expect(html).toContain(
      `src="https://r2.example.com/b/diffs/${comparison.label}/mobile/big.png?X-Amz-Signature=a&amp;b=1"`,
    );
    expect(html).not.toContain('https://pub.example.com/');
  });

  it('needs a publicUrl or an imageUrl', () => {
    expect(() => renderStaticReport(comparison, items, { publicUrl: null })).toThrow(/publicUrl/);
  });

  it('shows the all-match banner when no file changed', () => {
    expect(renderStaticReport(comparison, [items[9]!], opts)).toContain(
      'All file fingerprints match.',
    );
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML metacharacters and nullish values', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(3)).toBe('3');
  });
});
