import type { ItemStatus, RunStatus } from '@vrt/shared';

/** Pure helpers for the runs UI: progress segments, ETA, estimates, grouping (F-RUN-1/3, 06 §7). */

export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ['queued', 'running'];
export const RETRYABLE_RUN_STATUSES: readonly RunStatus[] = ['completed_with_errors', 'failed'];
export const BASELINE_RUN_STATUSES: readonly RunStatus[] = ['completed', 'completed_with_errors'];

export function isActiveRun(status: string): boolean {
  return (ACTIVE_RUN_STATUSES as readonly string[]).includes(status);
}

/** A queued/running run or running snapshot for the active-job indicator (08 §2). */
export interface ActiveJob {
  kind: 'run' | 'snapshot';
  id: string;
  projectId: string;
  label: string;
  status: string;
  done: number;
  total: number;
}

export interface RunCounts {
  total: number;
  done: number;
  failed: number;
}

export function pendingOf(counts: RunCounts): number {
  return Math.max(0, counts.total - counts.done - counts.failed);
}

export function percentOf(part: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((part / total) * 100)) : 0;
}

export interface ItemStat {
  viewportSlug: string | null;
  status: ItemStatus;
  items: number;
  bytes: number;
}

export interface ViewportProgress extends RunCounts {
  /** `null` groups files (fingerprinted once, not per viewport). */
  viewportSlug: string | null;
}

/** Per-viewport counts in the run's viewport order, files last (08 §3 segmented progress). */
export function viewportProgress(
  viewportSlugs: readonly string[],
  stats: readonly ItemStat[],
): ViewportProgress[] {
  const order = [...viewportSlugs];
  for (const s of stats) {
    if (s.viewportSlug !== null && !order.includes(s.viewportSlug)) order.push(s.viewportSlug);
  }
  const keys: (string | null)[] = [...order];
  if (stats.some((s) => s.viewportSlug === null)) keys.push(null);
  return keys.map((viewportSlug) => {
    const rows = stats.filter((s) => s.viewportSlug === viewportSlug);
    const sum = (status?: ItemStatus) =>
      rows.filter((r) => !status || r.status === status).reduce((n, r) => n + r.items, 0);
    return { viewportSlug, total: sum(), done: sum('done'), failed: sum('failed') };
  });
}

export function totalBytes(stats: readonly ItemStat[]): number {
  return stats.reduce((n, s) => n + s.bytes, 0);
}

export interface ProgressSample {
  /** Milliseconds since the epoch. */
  at: number;
  /** Items finished (done + failed) at that time. */
  processed: number;
}

/** Samples kept for the moving average of the item rate. */
export const ETA_WINDOW = 10;

/** Appends a sample, keeping the last `ETA_WINDOW`; a sample without new progress is dropped. */
export function addSample(samples: readonly ProgressSample[], sample: ProgressSample) {
  const last = samples.at(-1);
  if (last && sample.processed <= last.processed) return [...samples];
  return [...samples, sample].slice(-ETA_WINDOW);
}

/**
 * 06 §7: ETA = remaining items × moving average item duration ÷ effective concurrency. The
 * observed rate (items finished per ms across all slots) already includes the concurrency, so
 * the ETA is remaining ÷ rate. Without two samples, the rate since `startedAt` is used.
 * Returns milliseconds, or null when there is no basis yet.
 */
export function estimateEtaMs(
  counts: RunCounts,
  samples: readonly ProgressSample[],
  startedAt: number | null,
  now: number,
): number | null {
  const remaining = pendingOf(counts);
  if (remaining === 0) return 0;
  const first = samples[0];
  const last = samples.at(-1);
  let rate: number | null = null;
  if (first && last && last.at > first.at && last.processed > first.processed) {
    rate = (last.processed - first.processed) / (last.at - first.at);
  } else if (startedAt !== null && now > startedAt) {
    const processed = counts.done + counts.failed;
    if (processed > 0) rate = processed / (now - startedAt);
  }
  return rate ? Math.round(remaining / rate) : null;
}

/** Default duration of one capture when no finished run gives a better figure. */
export const DEFAULT_ITEM_MS = 6_000;

/** F-RUN-1: ≈ duration of a run of `items` items at `concurrency` parallel captures. */
export function estimateRunMs(items: number, itemMs: number, concurrency: number): number {
  return Math.round((items * itemMs) / Math.max(1, concurrency));
}

/** `1 h 05 min`, `4 min 10 s`, `12 s`. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min ${String(sec).padStart(2, '0')} s`;
  return `${sec} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export interface FailureGroup {
  error: string;
  items: { id: string; url: string; viewportSlug: string | null }[];
}

/** F-RUN-3 Failures tab: failed items grouped by error message, largest group first. */
export function groupFailures(
  items: readonly { id: string; url: string; viewportSlug: string | null; error: string | null }[],
): FailureGroup[] {
  const groups = new Map<string, FailureGroup>();
  for (const item of items) {
    const error = item.error?.trim() || 'Unknown error';
    const group = groups.get(error) ?? { error, items: [] };
    group.items.push({ id: item.id, url: item.url, viewportSlug: item.viewportSlug });
    groups.set(error, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.items.length - a.items.length || a.error.localeCompare(b.error),
  );
}
