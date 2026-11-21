/**
 * Sitemap snapshot assembly, `.txt` export and snapshot diff (specification/05-engine.md §3,
 * F-SITEMAP-2..4).
 */
import { isFileUrl, type FileExtensions } from './files';
import { isUrlIgnored } from './ignore-rules';
import type { RedirectCheckResult } from './sitemap';
import type { IgnoreRule } from './types';

export type SnapshotUrlSource = 'sitemap' | 'manual';

/** One `sitemap_urls` row (without ids). */
export interface SnapshotUrl {
  url: string;
  kind: 'page' | 'file';
  httpStatus: number | null;
  redirectTo: string | null;
  included: boolean;
  source: SnapshotUrlSource;
}

export interface SnapshotCounts {
  urlCount: number;
  redirectCount: number;
  errorCount: number;
}

/**
 * Sitemap URLs plus manual URLs not already in the sitemap, deduped and sorted (step 5).
 * Returns the URL and where it came from.
 */
export function mergeManualUrls(
  sitemapUrls: readonly string[],
  manualUrls: readonly string[],
): { url: string; source: SnapshotUrlSource }[] {
  const sources = new Map<string, SnapshotUrlSource>();
  for (const url of sitemapUrls) sources.set(url, 'sitemap');
  for (const url of manualUrls) if (!sources.has(url)) sources.set(url, 'manual');
  return [...sources.keys()].sort().map((url) => ({ url, source: sources.get(url)! }));
}

export interface BuildSnapshotOptions {
  /** Redirect check results by URL; absent when `check_redirects` is off. */
  checks?: ReadonlyMap<string, RedirectCheckResult>;
  ignoreRules?: readonly IgnoreRule[];
  fileExtensions?: FileExtensions;
}

/**
 * Builds the rows of a snapshot (steps 6 and 7): redirects are excluded with their target,
 * URLs matching an enabled `url_pattern` rule (capture/both, all viewports) are excluded.
 */
export function buildSnapshotUrls(
  entries: readonly { url: string; source: SnapshotUrlSource }[],
  opts: BuildSnapshotOptions = {},
): SnapshotUrl[] {
  return entries.map(({ url, source }) => {
    const check = opts.checks?.get(url);
    const ignored = isUrlIgnored(opts.ignoreRules ?? [], url, 'capture', null);
    return {
      url,
      kind: isFileUrl(url, opts.fileExtensions) ? 'file' : 'page',
      httpStatus: check?.httpStatus ?? null,
      redirectTo: check?.redirectTo ?? null,
      included: (check?.included ?? true) && !ignored,
      source,
    };
  });
}

/** True for a kept URL whose check failed or returned ≥ 400 (shown as a warning). */
export function isErrorUrl(row: Pick<SnapshotUrl, 'httpStatus' | 'redirectTo'>, checked = true) {
  if (row.redirectTo) return false;
  return row.httpStatus === null ? checked : row.httpStatus >= 400;
}

/**
 * `url_count` = included URLs, `redirect_count` = 3xx URLs, `error_count` = URLs whose check
 * failed or returned ≥ 400. Unchecked snapshots (`check_redirects` off) count no errors.
 */
export function snapshotCounts(rows: readonly SnapshotUrl[], checked: boolean): SnapshotCounts {
  let urlCount = 0;
  let redirectCount = 0;
  let errorCount = 0;
  for (const row of rows) {
    if (row.included) urlCount++;
    if (
      row.redirectTo ||
      (row.httpStatus !== null && row.httpStatus >= 300 && row.httpStatus < 400)
    )
      redirectCount++;
    else if (checked && isErrorUrl(row)) errorCount++;
  }
  return { urlCount, redirectCount, errorCount };
}

/** Prototype `sitemap.txt`: the included URLs, sorted, one per line, trailing newline. */
export function formatSitemapTxt(rows: readonly Pick<SnapshotUrl, 'url' | 'included'>[]): string {
  const urls = rows
    .filter((row) => row.included)
    .map((row) => row.url)
    .sort();
  return urls.join('\n') + '\n';
}

/** Added / removed URLs between two snapshots (F-SITEMAP-3). Both lists sorted. */
export function diffSnapshotUrls(
  previous: readonly string[],
  current: readonly string[],
): { added: string[]; removed: string[] } {
  const before = new Set(previous);
  const after = new Set(current);
  return {
    added: [...after].filter((url) => !before.has(url)).sort(),
    removed: [...before].filter((url) => !after.has(url)).sort(),
  };
}
