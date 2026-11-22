/**
 * Static HTML report export (specification/05-engine.md §9, REQ-ENG-9). Same sections as the
 * prototype `buildHtml`, but every dynamic value is HTML-escaped and images are absolute URLs
 * under the project's `r2_public_url`.
 */
import type { CmpItemStatus, ItemKind, ReviewStatus } from '@vrt/shared';

export interface ReportComparison {
  label: string;
  project_name: string;
  before_label: string;
  after_label: string;
  change_threshold_pct: number;
}

/** Subset of a fingerprint (`comparison_items.fp_before` / `fp_after`). */
export interface ReportFingerprint {
  sha256?: string | null;
  size?: number | string | null;
}

/** Subset of a `comparison_items` row. */
export interface ReportItem {
  url: string | null;
  name: string;
  kind: ItemKind;
  viewport_slug: string | null;
  status: CmpItemStatus;
  diff_pct?: number | null;
  diff_pixels?: number | null;
  total_pixels?: number | null;
  before_key?: string | null;
  after_key?: string | null;
  diff_key?: string | null;
  redirect_to?: string | null;
  fp_before?: ReportFingerprint | null;
  fp_after?: ReportFingerprint | null;
  review?: ReviewStatus | null;
  error?: string | null;
}

export interface ReportOptions {
  /** `projects.r2_public_url`; image `src` are `<publicUrl>/<r2 key>`. */
  publicUrl?: string | null;
  /**
   * Absolute image URL of an R2 key, for projects without a public URL (e.g. a presigned URL in a
   * downloaded export, F-CMP-8). Takes precedence over `publicUrl`.
   */
  imageUrl?: (key: string) => string;
  /** Defaults to now; injectable for deterministic output. */
  generatedAt?: Date;
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

const esc = escapeHtml;
const num = (n: number | null | undefined) => (n ?? 0).toLocaleString('en-US');

const BASE_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0f1117; color: #e2e8f0; line-height: 1.5; }
  a { color: #60a5fa; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .topbar { background: #1e2433; border-bottom: 1px solid #2d3748; padding: 18px 32px; }
  .topbar h1 { font-size: 1.25rem; font-weight: 700; color: #f0f4ff; }
  .topbar h1 span { color: #818cf8; }
  .topbar .breadcrumb { font-size: .8rem; color: #64748b; margin-bottom: 6px; }
  .meta-row { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 10px; font-size: .85rem; color: #94a3b8; }
  .meta-row strong { color: #cbd5e1; }
  .chip { padding: 6px 14px; border-radius: 99px; font-size: .8rem; font-weight: 600; }
  .chip-total   { background: #1e2433; color: #94a3b8; border: 1px solid #2d3748; }
  .chip-changed { background: #3b1f2b; color: #f87171; border: 1px solid #7f1d1d; }
  .chip-ok      { background: #1a2e22; color: #4ade80; border: 1px solid #14532d; }
  .chip-new     { background: #1c2c42; color: #60a5fa; border: 1px solid #1e40af; }
  .chip-missing { background: #2a1f10; color: #fb923c; border: 1px solid #7c2d12; }
  .chip-redirect { background: #261f3a; color: #a78bfa; border: 1px solid #5b21b6; }
  .chip-file    { background: #2a2410; color: #facc15; border: 1px solid #713f12; }
  .chip-error   { background: #3b1f2b; color: #fca5a5; border: 1px solid #7f1d1d; }
  .summary { display: flex; gap: 12px; flex-wrap: wrap; padding: 20px 32px; }
  @media (max-width: 900px) { .topbar, main, .summary { padding-left: 16px; padding-right: 16px; } }
`;

const PAGE_CSS = `
  .no-changes { margin: 24px 32px; padding: 20px 24px; background: #1a2e22;
                border: 1px solid #14532d; border-radius: 8px; color: #4ade80; font-size: 1rem; font-weight: 500; }
  main { padding: 0 32px 48px; }
  .diff-block { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 10px; margin-bottom: 28px; overflow: hidden; }
  .diff-header { padding: 14px 18px; border-bottom: 1px solid #2d3748; }
  .diff-title  { font-size: .95rem; font-weight: 600; word-break: break-all; margin-bottom: 8px; }
  .diff-meta   { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: .8rem; }
  .badge { padding: 3px 10px; border-radius: 99px; font-weight: 700; font-size: .75rem; }
  .bar-high { background: #7f1d1d; color: #fca5a5; }
  .bar-mid  { background: #78350f; color: #fcd34d; }
  .bar-low  { background: #1e3a5f; color: #93c5fd; }
  .review-pending  { background: #2d3748; color: #cbd5e1; }
  .review-approved { background: #14532d; color: #4ade80; }
  .review-rejected { background: #7f1d1d; color: #fca5a5; }
  .review-ignored  { background: #374151; color: #9ca3af; }
  .viewport { color: #94a3b8; }
  .px-count { color: #64748b; }
  .diff-bar-track { height: 4px; background: #2d3748; border-radius: 2px; margin-top: 10px; }
  .diff-bar { height: 100%; border-radius: 2px; }
  .diff-bar.bar-high { background: #ef4444; }
  .diff-bar.bar-mid  { background: #f59e0b; }
  .diff-bar.bar-low  { background: #3b82f6; }
  .img-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: #2d3748; }
  figure { background: #0f1117; padding: 10px; }
  figcaption { font-size: .75rem; color: #64748b; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
  figcaption small { font-size: .7rem; color: #475569; text-transform: none; letter-spacing: 0; }
  figure img { width: 100%; height: auto; display: block; border-radius: 4px; border: 1px solid #2d3748; }
  .extras { padding: 0 32px 32px; }
  .extras h2 { font-size: .9rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .07em; margin: 24px 0 10px; }
  .extras ul { list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .extras li { font-size: .85rem; padding: 7px 12px; border-radius: 6px; }
  .status-new     { background: #1c2c42; border-left: 3px solid #3b82f6; }
  .status-missing { background: #2a1f10; border-left: 3px solid #f97316; }
  .status-redirect { background: #261f3a; border-left: 3px solid #a78bfa; word-break: break-all; }
  .status-error   { background: #3b1f2b; border-left: 3px solid #ef4444; word-break: break-all; }
  .files { padding: 0 32px 24px; }
  .files h2 { font-size: .9rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .07em; margin: 8px 0 10px; }
  .files h3 { font-size: .8rem; color: #94a3b8; margin: 16px 0 8px; }
  .files ul { list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .files li { font-size: .85rem; padding: 7px 12px; border-radius: 6px; word-break: break-all; }
  .fp-summary { font-size: .85rem; color: #94a3b8; margin-bottom: 12px; }
  .fp-alert { background: #3b1f2b; border: 1px solid #7f1d1d; color: #fca5a5; padding: 10px 14px; border-radius: 8px; font-weight: 600; margin-bottom: 10px; }
  .fp-ok { background: #1a2e22; border: 1px solid #14532d; color: #4ade80; padding: 10px 14px; border-radius: 8px; }
  .fp-card { background: #1a1f2e; border: 1px solid #2d3748; border-left: 3px solid #ef4444; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
  .fp-title { font-size: .9rem; font-weight: 600; word-break: break-all; margin-bottom: 8px; }
  .fp-row { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; font-size: .8rem; margin-top: 4px; }
  .fp-row span { width: 50px; color: #64748b; text-transform: uppercase; font-weight: 600; font-size: .7rem; }
  .fp-row code { font-family: ui-monospace, Menlo, monospace; color: #e2e8f0; word-break: break-all; }
  .fp-row em { color: #64748b; font-style: normal; }
  @media (max-width: 900px) { .img-row { grid-template-columns: 1fr; } }
`;

function link(item: ReportItem): string {
  return item.url
    ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.url)}</a>`
    : `<span style="color:#64748b;font-style:italic">${esc(item.name)}</span>`;
}

function viewportTag(item: ReportItem): string {
  return item.viewport_slug ? ` <span class="viewport">[${esc(item.viewport_slug)}]</span>` : '';
}

function reviewBadge(item: ReportItem): string {
  const review = item.review ?? 'pending';
  return `<span class="badge review-${esc(review)}">${esc(review)}</span>`;
}

function buildFileSection(files: ReportItem[]): string {
  if (!files.length) return '';
  const changed = files.filter((r) => r.status === 'changed');
  const newF = files.filter((r) => r.status === 'new');
  const missF = files.filter((r) => r.status === 'missing');
  const same = files.filter((r) => r.status === 'unchanged');

  const changedRows = changed
    .map(
      (r) => `
  <div class="fp-card">
    <div class="fp-title">⚠️ ${link(r)} ${reviewBadge(r)}</div>
    <div class="fp-row"><span>Before</span><code>${esc(r.fp_before?.sha256)}</code><em>${esc(r.fp_before?.size)} bytes</em></div>
    <div class="fp-row"><span>After</span><code>${esc(r.fp_after?.sha256)}</code><em>${esc(r.fp_after?.size)} bytes</em></div>
  </div>`,
    )
    .join('\n');

  const simpleList = (items: ReportItem[], cls: string, note: string) =>
    items.map((r) => `<li class="${cls}">${link(r)} <em>${note}</em></li>`).join('\n');

  return `
<section class="files">
  <h2>Files — fingerprint check (${files.length})</h2>
  <p class="fp-summary">${changed.length} changed · ${same.length} unchanged${newF.length ? ` · ${newF.length} new` : ''}${missF.length ? ` · ${missF.length} missing` : ''}</p>
  ${changed.length ? `<div class="fp-alert">🔔 ${changed.length} file(s) have a different fingerprint</div>${changedRows}` : '<div class="fp-ok">✅ All file fingerprints match.</div>'}
  ${newF.length ? `<h3>No fingerprint in before set (${newF.length})</h3><ul>${simpleList(newF, 'status-new', '(new)')}</ul>` : ''}
  ${missF.length ? `<h3>No fingerprint in after set (${missF.length})</h3><ul>${simpleList(missF, 'status-missing', '(missing)')}</ul>` : ''}
</section>`;
}

function publicImageUrl(publicUrl: string | null | undefined): (key: string) => string {
  if (!publicUrl) throw new Error('renderStaticReport needs a publicUrl or an imageUrl');
  const base = publicUrl.replace(/\/+$/, '');
  return (key) => `${base}/${key}`;
}

/** Renders one self-contained HTML document for a comparison. */
export function renderStaticReport(
  comparison: ReportComparison,
  items: readonly ReportItem[],
  opts: ReportOptions,
): string {
  const imageUrl = opts.imageUrl ?? publicImageUrl(opts.publicUrl);
  const img = (key: string | null | undefined) => esc(key ? imageUrl(key) : '');
  const pages = items.filter((i) => i.kind === 'page');
  const files = items.filter((i) => i.kind === 'file');

  const changed = pages
    .filter((r) => r.status === 'changed')
    .sort((x, y) => (y.diff_pct ?? 0) - (x.diff_pct ?? 0));
  const unchanged = pages.filter((r) => r.status === 'unchanged');
  const newPages = pages.filter((r) => r.status === 'new');
  const missing = pages.filter((r) => r.status === 'missing');
  const redirects = pages.filter((r) => r.status === 'redirect');
  const errors = pages.filter((r) => r.status === 'error');
  const totalCompared = changed.length + unchanged.length;
  const threshold = esc(comparison.change_threshold_pct);
  const before = esc(comparison.before_label);
  const after = esc(comparison.after_label);
  const site = esc(comparison.project_name);
  const generated = (opts.generatedAt ?? new Date()).toISOString().replace('T', ' ').slice(0, 19);

  const pageRows = changed
    .map((r) => {
      const pct = r.diff_pct ?? 0;
      const bar = Math.min(100, pct * 10);
      const barClass = pct > 5 ? 'bar-high' : pct > 1 ? 'bar-mid' : 'bar-low';
      return `
<article class="diff-block">
  <header class="diff-header">
    <div class="diff-title">${link(r)}${viewportTag(r)}</div>
    <div class="diff-meta">
      <span class="badge ${barClass}">${pct.toFixed(2)}% changed</span>
      ${reviewBadge(r)}
      <span class="px-count">${num(r.diff_pixels)} px / ${num(r.total_pixels)} total</span>
    </div>
    <div class="diff-bar-track"><div class="diff-bar ${barClass}" style="width:${bar}%"></div></div>
  </header>
  <div class="img-row">
    <figure>
      <figcaption>Before <small>(${before})</small></figcaption>
      <img src="${img(r.before_key)}" loading="lazy" alt="before">
    </figure>
    <figure>
      <figcaption>Diff <small>(changed pixels highlighted)</small></figcaption>
      <img src="${img(r.diff_key)}" loading="lazy" alt="diff">
    </figure>
    <figure>
      <figcaption>After <small>(${after})</small></figcaption>
      <img src="${img(r.after_key)}" loading="lazy" alt="after">
    </figure>
  </div>
</article>`;
    })
    .join('\n');

  const listItems = (list: ReportItem[], cls: string, note: string) =>
    list
      .map((r) => `<li class="${cls}">${link(r)}${viewportTag(r)} <em>${note}</em></li>`)
      .join('\n');

  const redirectItems = redirects
    .map(
      (r) =>
        `<li class="status-redirect"><strong>${esc(r.url ?? r.name)}</strong>${viewportTag(r)} … ↪️ redirect detected → <a href="${esc(r.redirect_to)}" target="_blank" rel="noopener">${esc(r.redirect_to)}</a></li>`,
    )
    .join('\n');

  const errorItems = errors
    .map(
      (r) =>
        `<li class="status-error">${link(r)}${viewportTag(r)} <em>${esc(r.error || 'error')}</em></li>`,
    )
    .join('\n');

  const extras =
    newPages.length || missing.length || redirects.length || errors.length
      ? `
<section class="extras">
  ${redirects.length ? `<h2>Redirected pages — not compared (${redirects.length})</h2><ul>${redirectItems}</ul>` : ''}
  ${newPages.length ? `<h2>New pages (${newPages.length})</h2><ul>${listItems(newPages, 'status-new', '(not in before set)')}</ul>` : ''}
  ${missing.length ? `<h2>Missing pages (${missing.length})</h2><ul>${listItems(missing, 'status-missing', '(missing in after set)')}</ul>` : ''}
  ${errors.length ? `<h2>Pages with errors (${errors.length})</h2><ul>${errorItems}</ul>` : ''}
</section>`
      : '';

  const noChanges =
    changed.length === 0
      ? `<div class="no-changes">✅ No visual differences detected above the ${threshold}% threshold.</div>`
      : '';
  const filesChanged = files.filter((r) => r.status === 'changed').length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visual Diff — ${site} — ${before} vs ${after}</title>
<style>
${BASE_CSS}
${PAGE_CSS}
</style>
</head>
<body>
<div class="topbar">
  <div class="breadcrumb">${site}</div>
  <h1>Visual Diff — <span>${site}</span></h1>
  <div class="meta-row">
    <div><strong>Before:</strong> ${before}</div>
    <div><strong>After:</strong> ${after}</div>
    <div><strong>Threshold:</strong> &gt;${threshold}% pixel change</div>
    <div><strong>Generated:</strong> ${generated} UTC</div>
  </div>
</div>
<div class="summary">
  <div class="chip chip-total">📄 ${totalCompared} compared</div>
  <div class="chip chip-changed">🔴 ${changed.length} changed</div>
  <div class="chip chip-ok">✅ ${unchanged.length} unchanged</div>
  ${newPages.length ? `<div class="chip chip-new">🆕 ${newPages.length} new</div>` : ''}
  ${missing.length ? `<div class="chip chip-missing">⚠️ ${missing.length} missing</div>` : ''}
  ${redirects.length ? `<div class="chip chip-redirect">↪️ ${redirects.length} redirected</div>` : ''}
  ${errors.length ? `<div class="chip chip-error">❌ ${errors.length} errors</div>` : ''}
  ${files.length ? `<div class="chip chip-file">📎 ${filesChanged} / ${files.length} files changed</div>` : ''}
</div>
${noChanges}
${buildFileSection(files)}
<main>${pageRows}</main>
${extras}
</body>
</html>`;
}
