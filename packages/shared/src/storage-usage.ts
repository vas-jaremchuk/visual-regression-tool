import { z } from 'zod';
import type { ObjectEntry } from './object-store';
import { DIFFS_PREFIX, REPORTS_PREFIX, SCREENSHOTS_PREFIX } from './r2-keys';

/**
 * Storage accounting (F-STORAGE-1, port of prototype `storage.js`): bytes and object count per
 * top-level prefix of a bucket. Keys outside `screenshots/`, `diffs/` and `reports/` count as
 * `other`. Cached in `storage_usage.groups`.
 */

export const storageGroup = z.enum(['screenshots', 'diffs', 'reports', 'other']);
export type StorageGroup = z.infer<typeof storageGroup>;

export const storageGroupUsage = z.object({
  prefix: storageGroup,
  bytes: z.number().int().min(0),
  objects: z.number().int().min(0),
});
export type StorageGroupUsage = z.infer<typeof storageGroupUsage>;

export interface StorageUsage {
  totalBytes: number;
  objectCount: number;
  /** One entry per group, in `storageGroup` order, including empty groups. */
  groups: StorageGroupUsage[];
}

const GROUP_PREFIXES: [StorageGroup, string][] = [
  ['screenshots', SCREENSHOTS_PREFIX],
  ['diffs', DIFFS_PREFIX],
  ['reports', REPORTS_PREFIX],
];

export function storageGroupOf(key: string): StorageGroup {
  return GROUP_PREFIXES.find(([, prefix]) => key.startsWith(prefix))?.[0] ?? 'other';
}

/** Totals the entries of one bucket listing by group. */
export function summarizeStorage(entries: Iterable<ObjectEntry>): StorageUsage {
  const groups = new Map<StorageGroup, StorageGroupUsage>(
    storageGroup.options.map((prefix) => [prefix, { prefix, bytes: 0, objects: 0 }]),
  );
  let totalBytes = 0;
  let objectCount = 0;
  for (const { key, size } of entries) {
    const group = groups.get(storageGroupOf(key))!;
    group.bytes += size;
    group.objects += 1;
    totalBytes += size;
    objectCount += 1;
  }
  return { totalBytes, objectCount, groups: [...groups.values()] };
}

/** `fmt()` of prototype `storage.js`. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export interface RetentionRun {
  id: string;
  label: string;
  isBaseline: boolean;
}

/**
 * F-STORAGE-5: keeping the newest `keep` non-baseline runs, returns the older ones as deletion
 * proposals, newest first. The baseline is never proposed. Proposals only; nothing is deleted.
 * Run labels are UTC timestamps, so they sort chronologically.
 */
export function retentionProposals<T extends RetentionRun>(runs: T[], keep: number): T[] {
  return runs
    .filter((run) => !run.isBaseline)
    .sort((a, b) => b.label.localeCompare(a.label))
    .slice(Math.max(0, keep));
}
