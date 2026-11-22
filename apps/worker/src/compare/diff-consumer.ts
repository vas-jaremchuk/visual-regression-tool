import {
  DIFF_MAX_ATTEMPTS,
  diffResponse,
  type DiffMsg,
  type DiffRequest,
  type DiffResponse,
  type Region,
} from '@vrt/shared';
import { regionsFor } from '@vrt/engine';
import type { Logger } from '../logger';
import type { CompareSettings } from './compare-job';

/** Diff consumer for `vrt-diff` (06 §6, REQ-JOB-5): one container `POST /diff` per pending pair. */

export interface DiffItem {
  id: string;
  url: string | null;
  viewportSlug: string | null;
  status: string;
  beforeKey: string | null;
  afterKey: string | null;
  diffKey: string | null;
}

export interface DiffComparison {
  id: string;
  projectId: string;
  status: string;
  bucket: string;
  settings: CompareSettings;
}

export interface DiffItemResult {
  status: 'changed' | 'unchanged' | 'error';
  diff_pct?: number;
  diff_pixels?: number;
  total_pixels?: number;
  before_dims?: [number, number];
  after_dims?: [number, number];
  error?: string | null;
}

export interface DiffRepo {
  getComparison(comparisonId: string): Promise<DiffComparison | null>;
  getItems(comparisonId: string, itemIds: string[]): Promise<DiffItem[]>;
  /** Writes the result to a still-pending item. */
  update(itemId: string, result: DiffItemResult): Promise<void>;
  refreshCounts(comparisonId: string): Promise<void>;
}

export interface DiffDeps {
  repo: DiffRepo;
  /** Calls the container's `POST /diff`; throws on transport errors and non-2xx answers. */
  diff(request: DiffRequest): Promise<DiffResponse>;
  log: Logger;
}

export class DiffContainerError extends Error {
  readonly status: number;

  constructor(status: number, body: string) {
    super(`Diff container answered ${status}: ${body.slice(0, 500)}`);
    this.name = 'DiffContainerError';
    this.status = status;
  }
}

/** 4xx answers (bad pair, oversized image) do not get better with a retry. */
function isPermanent(error: unknown): boolean {
  return error instanceof DiffContainerError && error.status >= 400 && error.status < 500;
}

function reason(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

export function diffRequest(comparison: DiffComparison, item: DiffItem): DiffRequest {
  const { settings } = comparison;
  const regions: Region[] = regionsFor(settings.ignoreRules, item.url ?? '', item.viewportSlug);
  return {
    bucket: comparison.bucket,
    beforeKey: item.beforeKey!,
    afterKey: item.afterKey!,
    diffKey: item.diffKey!,
    threshold: settings.threshold,
    changeThresholdPct: settings.changeThresholdPct,
    regions,
    maxPageHeight: settings.maxPageHeight,
  };
}

/**
 * Processes one message. Items already final are skipped, so redelivery is safe. A failed pair
 * makes the message throw so the queue retries it; on attempt `DIFF_MAX_ATTEMPTS` (or for a
 * permanent error) the pair becomes `error` instead.
 */
export async function processDiffMessage(
  msg: DiffMsg,
  attempt: number,
  deps: DiffDeps,
): Promise<void> {
  const { repo } = deps;
  const log = deps.log.child({ comparisonId: msg.comparisonId, step: 'diff' });
  const comparison = await repo.getComparison(msg.comparisonId);
  if (!comparison || comparison.status !== 'running') {
    log.warn('comparison not running; dropping message', { status: comparison?.status });
    return;
  }
  const items = (await repo.getItems(comparison.id, msg.itemIds)).filter(
    (i) => i.status === 'pending',
  );
  const failures: unknown[] = [];
  for (const item of items) {
    if (!item.beforeKey || !item.afterKey || !item.diffKey) {
      await repo.update(item.id, { status: 'error', error: 'missing object key' });
      continue;
    }
    try {
      const result = diffResponse.parse(await deps.diff(diffRequest(comparison, item)));
      await repo.update(item.id, {
        status: result.changed ? 'changed' : 'unchanged',
        diff_pct: result.diffPct,
        diff_pixels: result.diffPixels,
        total_pixels: result.totalPixels,
        before_dims: result.beforeDims,
        after_dims: result.afterDims,
        error: null,
      });
    } catch (error) {
      if (isPermanent(error) || attempt >= DIFF_MAX_ATTEMPTS) {
        log.warn('diff failed; item error', { itemId: item.id, attempt, error });
        await repo.update(item.id, { status: 'error', error: reason(error) });
      } else {
        failures.push(error);
      }
    }
  }
  await repo.refreshCounts(comparison.id);
  if (failures.length > 0) {
    throw new Error(`${failures.length} diff(s) failed: ${reason(failures[0])}`);
  }
}

/** `deps.diff` over the `DIFF_CONTAINER` binding, bearer-authenticated (09 §4). */
export function containerDiff(
  fetchContainer: (request: Request) => Promise<Response>,
  secret: string,
): DiffDeps['diff'] {
  return async (request) => {
    const res = await fetchContainer(
      new Request('http://diff-container/diff', {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify(request),
      }),
    );
    if (!res.ok) throw new DiffContainerError(res.status, await res.text());
    return diffResponse.parse(await res.json());
  };
}
