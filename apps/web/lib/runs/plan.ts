import { assignFilenames, isUrlIgnored, type IgnoreRule } from '@vrt/engine';
import type { ItemKind } from '@vrt/shared';

/** Run label and item planning for a new capture run (F-RUN-1, F-RUN-2, 05 §1, 06 §2). */

/** UTC `YYYY-MM-DD_HH-MM-SS` (F-RUN-2, prototype R2 folder name). */
export function formatRunLabel(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
}

/** `base`, or `base-2`, `base-3`… when the label is taken in the project (F-RUN-2). */
export function uniqueRunLabel(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export type RunScope = 'all' | 'pages' | 'files' | 'custom' | 'sample';

export interface SnapshotUrl {
  url: string;
  kind: ItemKind;
}

export interface PlannedItem {
  url: string;
  kind: ItemKind;
  /** null for files: they are fingerprinted once, not per viewport (F-VIEWPORT-2). */
  viewportSlug: string | null;
  filename: string;
}

export interface PlanInput {
  /** The snapshot's included URLs. */
  urls: readonly SnapshotUrl[];
  /** Selected viewport slugs, in capture order. */
  viewports: readonly string[];
  scope: RunScope;
  /** Custom subset (scope `custom`); every URL must be one of `urls`. */
  customUrls?: readonly string[];
  /** Number of URLs to pick at random (scope `sample`). */
  sample?: number;
  /** Enabled ignore rules; `url_pattern` rules applying to capture exclude items. */
  ignoreRules: readonly IgnoreRule[];
  /** Returns a number in [0, 1); defaults to `Math.random`. */
  random?: () => number;
}

export interface RunPlan {
  items: PlannedItem[];
  /** URLs whose filename got a `__N` suffix (05 §1), shown as a warning in the run detail. */
  collisions: { url: string; filename: string; collidesWith: string }[];
  /** Custom URLs that are not included in the snapshot. */
  unknownUrls: string[];
}

const byUrl = (a: SnapshotUrl, b: SnapshotUrl) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0);

function sampleOf<T>(rows: readonly T[], n: number, random: () => number): T[] {
  const copy = [...rows];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, n);
}

/**
 * Items of a run: the scoped snapshot URLs × selected viewports for pages, once for files, minus
 * URLs excluded by ignore rules. Filenames are assigned over the whole snapshot (per kind, in URL
 * order), so a URL keeps its filename whatever subset a run captures.
 */
export function planRunItems(input: PlanInput): RunPlan {
  const urls = [...new Map(input.urls.map((u) => [u.url, u])).values()].sort(byUrl);

  const filenames = new Map<string, string>();
  const collisions: RunPlan['collisions'] = [];
  for (const kind of ['page', 'file'] as const) {
    for (const assigned of assignFilenames(urls.filter((u) => u.kind === kind).map((u) => u.url))) {
      filenames.set(assigned.url, assigned.filename);
      if (assigned.collidesWith) {
        collisions.push({
          url: assigned.url,
          filename: assigned.filename,
          collidesWith: assigned.collidesWith,
        });
      }
    }
  }

  let scoped: SnapshotUrl[];
  let unknownUrls: string[] = [];
  switch (input.scope) {
    case 'pages':
      scoped = urls.filter((u) => u.kind === 'page');
      break;
    case 'files':
      scoped = urls.filter((u) => u.kind === 'file');
      break;
    case 'custom': {
      const wanted = new Set(input.customUrls ?? []);
      const known = new Set(urls.map((u) => u.url));
      unknownUrls = [...wanted].filter((url) => !known.has(url));
      scoped = urls.filter((u) => wanted.has(u.url));
      break;
    }
    case 'sample':
      scoped = sampleOf(urls, input.sample ?? 0, input.random ?? Math.random).sort(byUrl);
      break;
    default:
      scoped = urls;
  }

  const items: PlannedItem[] = [];
  for (const { url, kind } of scoped) {
    const filename = filenames.get(url)!;
    if (kind === 'file') {
      if (!isUrlIgnored(input.ignoreRules, url, 'capture', null)) {
        items.push({ url, kind, viewportSlug: null, filename });
      }
      continue;
    }
    for (const viewportSlug of input.viewports) {
      if (isUrlIgnored(input.ignoreRules, url, 'capture', viewportSlug)) continue;
      items.push({ url, kind, viewportSlug, filename });
    }
  }
  const usedUrls = new Set(items.map((item) => item.url));
  return {
    items,
    collisions: collisions.filter((c) => usedUrls.has(c.url)),
    unknownUrls,
  };
}
