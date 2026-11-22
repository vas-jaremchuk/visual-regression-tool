/** Comparison matrix (specification/05-engine.md §6, REQ-ENG-6). */
import type { CmpItemStatus, ItemKind, ItemStatus } from '@vrt/shared';

/** Subset of a `run_items` row the matrix needs. */
export interface MatrixRunItem {
  /** null for legacy items whose URL could not be reconstructed. */
  url: string | null;
  kind: ItemKind;
  /** null for files. Legacy run items use 'desktop'. */
  viewport_slug: string | null;
  filename: string;
  status: ItemStatus;
  sha256?: string | null;
  error?: string | null;
}

/**
 * `pending` = both page captures are done; the caller runs the redirect check and pixel diff.
 * Files are settled here: equal sha256 → `unchanged`, different → `changed`.
 */
export type MatrixStatus = Exclude<CmpItemStatus, 'redirect'>;

export interface MatrixEntry<T extends MatrixRunItem = MatrixRunItem> {
  kind: ItemKind;
  viewport_slug: string | null;
  filename: string;
  /** Filename without extension. */
  name: string;
  url: string | null;
  before: T | null;
  after: T | null;
  status: MatrixStatus;
  error?: string;
}

export interface ComparisonMatrix<T extends MatrixRunItem = MatrixRunItem> {
  entries: MatrixEntry<T>[];
  /** Viewports compared (present in both runs). */
  viewports: string[];
  /** Info only: viewports captured in one run but not the other. */
  viewportsNotInAfter: string[];
  viewportsNotInBefore: string[];
}

export interface MatrixOptions {
  /** `runs.viewport_slugs`; derived from the page items when omitted. */
  beforeViewports?: readonly string[];
  afterViewports?: readonly string[];
}

function keyOf(item: MatrixRunItem): string {
  return `${item.kind}\u0000${item.kind === 'file' ? '' : (item.viewport_slug ?? '')}\u0000${item.filename}`;
}

function pageViewports(items: readonly MatrixRunItem[]): string[] {
  return [
    ...new Set(items.filter((i) => i.kind === 'page').map((i) => i.viewport_slug ?? '')),
  ].filter(Boolean);
}

function failure(label: string, item: MatrixRunItem): string | null {
  if (item.status === 'done') return null;
  return `${label}: ${item.error || `item ${item.status}`}`;
}

export function buildComparisonMatrix<T extends MatrixRunItem>(
  beforeItems: readonly T[],
  afterItems: readonly T[],
  opts: MatrixOptions = {},
): ComparisonMatrix<T> {
  const beforeVps = new Set(opts.beforeViewports ?? pageViewports(beforeItems));
  const afterVps = new Set(opts.afterViewports ?? pageViewports(afterItems));
  const viewports = [...beforeVps].filter((v) => afterVps.has(v)).sort();
  const shared = new Set(viewports);

  const keep = (i: T) => i.kind === 'file' || shared.has(i.viewport_slug ?? '');
  const before = new Map(beforeItems.filter(keep).map((i) => [keyOf(i), i]));
  const after = new Map(afterItems.filter(keep).map((i) => [keyOf(i), i]));
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();

  const entries = keys.map((key): MatrixEntry<T> => {
    const b = before.get(key) ?? null;
    const a = after.get(key) ?? null;
    const ref = (a ?? b) as T;
    const entry: MatrixEntry<T> = {
      kind: ref.kind,
      viewport_slug: ref.kind === 'file' ? null : ref.viewport_slug,
      filename: ref.filename,
      name: ref.filename.replace(/\.(png|txt)$/i, ''),
      url: ref.url,
      before: b,
      after: a,
      status: 'pending',
    };
    if (!b) return { ...entry, status: 'new' };
    if (!a) return { ...entry, status: 'missing' };
    const error = [failure('before', b), failure('after', a)].filter(Boolean).join('; ');
    if (error) return { ...entry, status: 'error', error };
    if (ref.kind === 'file') {
      return { ...entry, status: (b.sha256 ?? '') === (a.sha256 ?? '') ? 'unchanged' : 'changed' };
    }
    return entry;
  });

  return {
    entries,
    viewports,
    viewportsNotInAfter: [...beforeVps].filter((v) => !afterVps.has(v)).sort(),
    viewportsNotInBefore: [...afterVps].filter((v) => !beforeVps.has(v)).sort(),
  };
}
