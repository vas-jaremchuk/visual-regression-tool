import { LEGACY_VIEWPORT_SLUG } from './constants';

/**
 * The only place R2 object keys are built (02 §3). Per-project bucket layout:
 *
 *   screenshots/<run.label>/<viewport_slug>/<filename>.png   page screenshot
 *   screenshots/<run.label>/_files/<filename>.txt            file fingerprint
 *   diffs/<cmp.label>/<viewport_slug>/<filename>.png         diff image
 *   reports/<cmp.label>/index.html                           static export
 *
 * Legacy prototype runs: screenshots/<ts>/<filename>.png and screenshots/<ts>/<filename>.txt.
 *
 * `filename` is `run_items.filename`, i.e. engine `urlToFilename(url)` including `.png`;
 * a name without the extension is accepted too.
 */

export const SCREENSHOTS_PREFIX = 'screenshots/';
export const DIFFS_PREFIX = 'diffs/';
export const REPORTS_PREFIX = 'reports/';
export const FILES_DIR = '_files';

const RUN_LABEL_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d+)?$/;
const VIEWPORT_SLUG_RE = /^[a-z0-9-]+$/;

export function isRunLabel(label: string): boolean {
  return RUN_LABEL_RE.test(label);
}

function assertRunLabel(label: string): void {
  if (!isRunLabel(label)) throw new Error(`Invalid run label: ${JSON.stringify(label)}`);
}

function assertViewportSlug(slug: string): void {
  if (!VIEWPORT_SLUG_RE.test(slug) || slug === FILES_DIR) {
    throw new Error(`Invalid viewport slug: ${JSON.stringify(slug)}`);
  }
}

function assertComparisonLabel(label: string): void {
  const [before, after, ...rest] = label.split('_vs_');
  if (rest.length > 0 || !before || !after || !isRunLabel(before) || !isRunLabel(after)) {
    throw new Error(`Invalid comparison label: ${JSON.stringify(label)}`);
  }
}

/** Strips a trailing `.png` (case-insensitive) and rejects names that would escape a prefix. */
function baseName(filename: string): string {
  const base = filename.replace(/\.png$/i, '');
  if (!base || base.includes('/') || base === '.' || base === '..') {
    throw new Error(`Invalid filename: ${JSON.stringify(filename)}`);
  }
  return base;
}

export function comparisonLabel(beforeLabel: string, afterLabel: string): string {
  assertRunLabel(beforeLabel);
  assertRunLabel(afterLabel);
  return `${beforeLabel}_vs_${afterLabel}`;
}

// ---- new layout -------------------------------------------------------------

export function runPrefix(runLabel: string): string {
  assertRunLabel(runLabel);
  return `${SCREENSHOTS_PREFIX}${runLabel}/`;
}

export function screenshotKey(runLabel: string, viewportSlug: string, filename: string): string {
  assertViewportSlug(viewportSlug);
  return `${runPrefix(runLabel)}${viewportSlug}/${baseName(filename)}.png`;
}

export function fingerprintKey(runLabel: string, filename: string): string {
  return `${runPrefix(runLabel)}${FILES_DIR}/${baseName(filename)}.txt`;
}

export function diffPrefix(cmpLabel: string): string {
  assertComparisonLabel(cmpLabel);
  return `${DIFFS_PREFIX}${cmpLabel}/`;
}

export function diffKey(cmpLabel: string, viewportSlug: string, filename: string): string {
  assertViewportSlug(viewportSlug);
  return `${diffPrefix(cmpLabel)}${viewportSlug}/${baseName(filename)}.png`;
}

export function reportPrefix(cmpLabel: string): string {
  assertComparisonLabel(cmpLabel);
  return `${REPORTS_PREFIX}${cmpLabel}/`;
}

export function reportKey(cmpLabel: string): string {
  return `${reportPrefix(cmpLabel)}index.html`;
}

// ---- legacy layout ----------------------------------------------------------

export function legacyScreenshotKey(runLabel: string, filename: string): string {
  return `${runPrefix(runLabel)}${baseName(filename)}.png`;
}

export function legacyFingerprintKey(runLabel: string, filename: string): string {
  return `${runPrefix(runLabel)}${baseName(filename)}.txt`;
}

/** Builds the key for a run item in either layout. */
export function runItemKey(input: {
  runLabel: string;
  isLegacy: boolean;
  kind: 'page' | 'file';
  viewportSlug: string | null;
  filename: string;
}): string {
  const { runLabel, isLegacy, kind, viewportSlug, filename } = input;
  if (kind === 'file') {
    return isLegacy ? legacyFingerprintKey(runLabel, filename) : fingerprintKey(runLabel, filename);
  }
  if (isLegacy) return legacyScreenshotKey(runLabel, filename);
  if (!viewportSlug) throw new Error('Page items of non-legacy runs need a viewport slug');
  return screenshotKey(runLabel, viewportSlug, filename);
}

// ---- parsers ----------------------------------------------------------------

export interface LegacyObject {
  runLabel: string;
  /** Screenshot filename with `.png` (fingerprints are mapped back to their screenshot name). */
  filename: string;
  kind: 'page' | 'file';
  viewportSlug: typeof LEGACY_VIEWPORT_SLUG | null;
}

/**
 * Parses a key of the legacy layout. Returns null for anything else, including keys of the new
 * layout (which have a sub-directory under the run label) and unknown extensions.
 * Legacy screenshots of file links (e.g. `doc.pdf.png`) are returned as pages; callers filter them
 * with engine `isFileScreenshotName`.
 */
export function parseLegacyKey(key: string): LegacyObject | null {
  const match = /^screenshots\/([^/]+)\/([^/]+)\.(png|txt)$/i.exec(key);
  if (!match) return null;
  const [, runLabel, base, ext] = match as unknown as [string, string, string, string];
  if (!isRunLabel(runLabel)) return null;
  const isPng = ext.toLowerCase() === 'png';
  return {
    runLabel,
    filename: `${base}.png`,
    kind: isPng ? 'page' : 'file',
    viewportSlug: isPng ? LEGACY_VIEWPORT_SLUG : null,
  };
}

/**
 * Lists run labels that use the legacy layout, sorted ascending. A label with any key in a
 * sub-directory is treated as a new-layout run and excluded.
 */
export function legacyRunLabels(keys: Iterable<string>): string[] {
  const legacy = new Set<string>();
  const nested = new Set<string>();
  for (const key of keys) {
    const match = /^screenshots\/([^/]+)\/(.+)$/.exec(key);
    if (!match || !isRunLabel(match[1]!)) continue;
    if (match[2]!.includes('/')) nested.add(match[1]!);
    else if (parseLegacyKey(key)) legacy.add(match[1]!);
  }
  return [...legacy].filter((label) => !nested.has(label)).sort();
}

/** Extracts run labels from `listPrefixes('screenshots/')` output (`screenshots/<ts>/`). */
export function runLabelsFromPrefixes(prefixes: Iterable<string>): string[] {
  const labels = new Set<string>();
  for (const prefix of prefixes) {
    const match = /^screenshots\/([^/]+)\/?$/.exec(prefix);
    if (match && isRunLabel(match[1]!)) labels.add(match[1]!);
  }
  return [...labels].sort();
}
