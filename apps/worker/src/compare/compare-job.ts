import {
  buildComparisonMatrix,
  detectRedirect,
  isUrlIgnored,
  mapLimit,
  renderStaticReport,
  type Fetcher,
  type IgnoreRule,
  type MatrixEntry,
  type ReportItem,
} from '@vrt/engine';
import {
  DIFF_BATCH_SIZE,
  JOB_POLL_INTERVAL_MS,
  LEGACY_VIEWPORT_SLUG,
  REDIRECT_CHECK_CONCURRENCY,
  RUN_HARD_TIMEOUT_MS,
  diffKey,
  reportKey,
  runItemKey,
  type CmpItemStatus,
  type ComparisonStatus,
  type DiffMsg,
  type ItemKind,
  type ItemStatus,
  type ReviewStatus,
  type RunStatus,
} from '@vrt/shared';

/**
 * Compare job (06 §5, REQ-JOB-4; 05 §6–§7, REQ-ENG-6/7). `CompareWorkflow` runs `prepare`,
 * `matrix` (files are settled in it, step 3), `redirects`, `enqueue`, then `poll` every
 * `JOB_POLL_INTERVAL_MS` until no pair waits for the diff consumer, then `autoReview`, `export`
 * and `finalise`. Each is one durable step; state lives in the database, step results are small.
 */

export interface ComparisonRow {
  id: string;
  projectId: string;
  label: string;
  status: ComparisonStatus;
  beforeRunId: string;
  afterRunId: string;
  startedAt: string | null;
}

export interface CompareRun {
  id: string;
  projectId: string;
  label: string;
  status: RunStatus;
  isLegacy: boolean;
  viewportSlugs: string[];
}

export interface CompareProject {
  id: string;
  name: string;
  bucket: string;
  publicUrl: string | null;
  checkRedirects: boolean;
  diffThreshold: number;
  changeThresholdPct: number;
  maxPageHeight: number;
  basicAuthUser: string | null;
  /** `basic_auth_pass_enc`, decrypted by `deps.basicAuthHeader`. */
  basicAuthPassEnc: string | null;
}

export interface CompareRunItem {
  url: string;
  kind: ItemKind;
  viewport_slug: string | null;
  filename: string;
  status: ItemStatus;
  r2_key: string | null;
  sha256: string | null;
  bytes: number | null;
  http_status: number | null;
  content_type: string | null;
  last_modified: string | null;
  etag: string | null;
  final_url: string | null;
  error: string | null;
}

/** Settings frozen into `comparisons.settings` (06 §5 step 1). */
export interface CompareSettings {
  threshold: number;
  changeThresholdPct: number;
  maxPageHeight: number;
  checkRedirects: boolean;
  ignoreRules: IgnoreRule[];
  /** Filled by the matrix step (05 §6): compared viewports and the ones only in one run. */
  viewports?: string[];
  viewportsNotInBefore?: string[];
  viewportsNotInAfter?: string[];
}

export interface NewComparisonItem {
  comparison_id: string;
  url: string;
  name: string;
  kind: ItemKind;
  viewport_slug: string | null;
  status: CmpItemStatus;
  before_key: string | null;
  after_key: string | null;
  diff_key: string | null;
  fp_before: Record<string, unknown> | null;
  fp_after: Record<string, unknown> | null;
  error: string | null;
}

export interface PendingPair {
  id: string;
  url: string;
}

export interface ChangedItem {
  id: string;
  url: string;
  viewportSlug: string | null;
  afterKey: string | null;
}

export interface ComparisonPatch {
  status?: ComparisonStatus;
  settings?: CompareSettings;
  started_at?: string;
  finished_at?: string | null;
  report_r2_key?: string | null;
}

export interface ItemCounts {
  compared: number;
  changed: number;
  unchanged: number;
  new: number;
  missing: number;
  redirect: number;
  error: number;
  files_changed: number;
  files_total: number;
}

export type ReviewCounts = Record<ReviewStatus, number>;

/** Database access the job needs (service role in production, in-memory in tests). */
export interface CompareStore {
  loadComparison(comparisonId: string): Promise<ComparisonRow | null>;
  loadRun(runId: string): Promise<CompareRun | null>;
  loadProject(projectId: string): Promise<CompareProject>;
  /** Enabled ignore rules of the project. */
  loadIgnoreRules(projectId: string): Promise<IgnoreRule[]>;
  loadSettings(comparisonId: string): Promise<CompareSettings>;
  updateComparison(comparisonId: string, patch: ComparisonPatch): Promise<void>;
  listRunItems(runId: string): Promise<CompareRunItem[]>;
  deleteItems(comparisonId: string): Promise<void>;
  insertItems(items: NewComparisonItem[]): Promise<void>;
  /** Page items still waiting for the diff (`status = 'pending'`). */
  listPendingPairs(comparisonId: string): Promise<PendingPair[]>;
  /** Marks the pending items of `url` as redirected to `to`. */
  markRedirect(comparisonId: string, url: string, to: string): Promise<void>;
  /** Fails every pending item of the comparison with `error`. */
  failPending(comparisonId: string, error: string): Promise<void>;
  /** `changed` items whose review is still `pending`. */
  listUnreviewedChanged(comparisonId: string): Promise<ChangedItem[]>;
  /** Remembered approved/ignored decision for this URL, viewport and after-PNG hash (F-REVIEW-6). */
  findReviewMemory(
    projectId: string,
    url: string,
    viewportSlug: string | null,
    afterSha256: string,
  ): Promise<ReviewStatus | null>;
  setReview(itemIds: string[], review: ReviewStatus, note: string): Promise<void>;
  listReportItems(comparisonId: string): Promise<ReportItem[]>;
  refreshCounts(comparisonId: string): Promise<void>;
  /** `comparisons.counts` and `review_counts` as last refreshed. */
  loadCounts(comparisonId: string): Promise<{ counts: ItemCounts; review: ReviewCounts }>;
  /** Audit entry without a user actor (the worker acts for the system). */
  audit(action: string, projectId: string, details: Record<string, unknown>): Promise<void>;
}

export type CompareEvent = 'comparison_changed' | 'comparison_clean';

/** Notification hook (06 §5 step 9). T21 implements it with the project's channels. */
export interface Notifier {
  notify(
    event: CompareEvent,
    context: { projectId: string; comparisonId: string; label: string },
  ): Promise<void>;
}

export const noopNotifier: Notifier = { notify: async () => {} };

export interface CompareJobDeps {
  store: CompareStore;
  /** Fetcher for the redirect check; the SSRF guard is applied by the caller. */
  fetcher: Fetcher;
  /** `Authorization` header for the project's basic auth, or null. */
  basicAuthHeader(project: CompareProject): Promise<string | null>;
  /** Sends messages to `vrt-diff`. */
  enqueue(messages: DiffMsg[]): Promise<void>;
  /** Writes the static report to the project's bucket. */
  putReport(bucket: string, key: string, html: string): Promise<void>;
  notifier: Notifier;
  now?: () => Date;
}

export const ACTIVE_COMPARISON_STATUSES: readonly ComparisonStatus[] = ['queued', 'running'];
const COMPARABLE_RUN_STATUSES: readonly RunStatus[] = ['completed', 'completed_with_errors'];

/** Poll iterations before the hard timeout (same 6 h as capture runs). */
export const MAX_POLLS = Math.ceil(RUN_HARD_TIMEOUT_MS / JOB_POLL_INTERVAL_MS);

/** Messages per `sendBatch` call (Queues limit, LIMITS.md). */
export const SEND_BATCH_LIMIT = 100;

export const TIMEOUT_ERROR = 'timeout';

export class ComparisonNotFoundError extends Error {
  constructor(comparisonId: string) {
    super(`Comparison ${comparisonId} not found`);
    this.name = 'ComparisonNotFoundError';
  }
}

/** Legacy run items have no viewport; they are compared as `desktop` (05 §6). */
function withLegacyViewport(item: CompareRunItem): CompareRunItem {
  if (item.kind !== 'page' || item.viewport_slug) return item;
  return { ...item, viewport_slug: LEGACY_VIEWPORT_SLUG };
}

/** The item's object key: `run_items.r2_key`, else built from the run's layout. */
function objectKey(run: CompareRun, item: CompareRunItem): string {
  if (item.r2_key) return item.r2_key;
  return runItemKey({
    runLabel: run.label,
    isLegacy: run.isLegacy,
    kind: item.kind,
    viewportSlug: item.viewport_slug,
    filename: item.filename,
  });
}

function fingerprintOf(item: CompareRunItem | null): Record<string, unknown> | null {
  if (!item) return null;
  return {
    sha256: item.sha256,
    size: item.bytes,
    status: item.http_status,
    contentType: item.content_type,
    lastModified: item.last_modified,
    etag: item.etag,
    finalUrl: item.final_url,
  };
}

/** Run viewports: `runs.viewport_slugs`, or the page items' viewports (legacy runs have none). */
function runViewports(run: CompareRun, items: readonly CompareRunItem[]): string[] | undefined {
  if (run.viewportSlugs.length > 0 && !run.isLegacy) return run.viewportSlugs;
  const slugs = items.filter((i) => i.kind === 'page').map((i) => i.viewport_slug ?? '');
  return [...new Set(slugs)].filter(Boolean);
}

/**
 * Comparison items for the matrix (05 §6): new/missing/error/files are final, page pairs whose
 * captures are both done are `pending` for the redirect check and the pixel diff.
 */
export function comparisonItems(
  comparison: Pick<ComparisonRow, 'id' | 'label'>,
  before: CompareRun,
  after: CompareRun,
  beforeItems: readonly CompareRunItem[],
  afterItems: readonly CompareRunItem[],
) {
  const b = beforeItems.map(withLegacyViewport);
  const a = afterItems.map(withLegacyViewport);
  const matrix = buildComparisonMatrix(b, a, {
    beforeViewports: runViewports(before, b),
    afterViewports: runViewports(after, a),
  });
  const keyOf = (run: CompareRun, item: CompareRunItem | null) =>
    item?.status === 'done' ? objectKey(run, item) : null;
  const items = matrix.entries.map((entry: MatrixEntry<CompareRunItem>): NewComparisonItem => {
    const isFile = entry.kind === 'file';
    const paired = entry.status === 'pending';
    return {
      comparison_id: comparison.id,
      url: entry.url,
      name: entry.name,
      kind: entry.kind,
      viewport_slug: entry.viewport_slug,
      status: entry.status,
      before_key: keyOf(before, entry.before),
      after_key: keyOf(after, entry.after),
      diff_key:
        paired && entry.viewport_slug
          ? diffKey(comparison.label, entry.viewport_slug, entry.filename)
          : null,
      fp_before: isFile ? fingerprintOf(entry.before) : null,
      fp_after: isFile ? fingerprintOf(entry.after) : null,
      error: entry.error ?? null,
    };
  });
  return { items, matrix };
}

/** Groups pending pairs into `vrt-diff` messages of at most `size` items (06 §5 step 5). */
export function diffBatches(
  comparisonId: string,
  pairs: readonly PendingPair[],
  size = DIFF_BATCH_SIZE,
): DiffMsg[] {
  const messages: DiffMsg[] = [];
  for (let i = 0; i < pairs.length; i += size) {
    messages.push({ v: 1, comparisonId, itemIds: pairs.slice(i, i + size).map((p) => p.id) });
  }
  return messages;
}

/** 06 §5 step 9: changed pages still pending or rejected, or a changed file fingerprint. */
export function compareEvent(
  counts: Pick<ItemCounts, 'files_changed'>,
  review: { pending: number; rejected: number },
): CompareEvent {
  return review.pending + review.rejected > 0 || counts.files_changed > 0
    ? 'comparison_changed'
    : 'comparison_clean';
}

export function createCompareJob(comparisonId: string, deps: CompareJobDeps) {
  const { store } = deps;
  const now = () => (deps.now?.() ?? new Date()).toISOString();

  async function loadComparison(): Promise<ComparisonRow> {
    const comparison = await store.loadComparison(comparisonId);
    if (!comparison) throw new ComparisonNotFoundError(comparisonId);
    return comparison;
  }

  async function loadRuns(comparison: ComparisonRow): Promise<[CompareRun, CompareRun]> {
    const [before, after] = await Promise.all([
      store.loadRun(comparison.beforeRunId),
      store.loadRun(comparison.afterRunId),
    ]);
    for (const [name, run] of [
      ['before', before],
      ['after', after],
    ] as const) {
      if (!run || run.projectId !== comparison.projectId) {
        throw new Error(`The ${name} run is not in the comparison's project`);
      }
      if (!COMPARABLE_RUN_STATUSES.includes(run.status)) {
        throw new Error(`The ${name} run ${run.label} is ${run.status}, not completed`);
      }
    }
    return [before!, after!];
  }

  const job = {
    /**
     * Validates both runs, freezes the thresholds and the compare ignore rules into
     * `comparisons.settings` and sets the comparison `running`. Returns `skip` when it is
     * already final.
     */
    async prepare(): Promise<{ skip: boolean }> {
      const comparison = await loadComparison();
      if (!ACTIVE_COMPARISON_STATUSES.includes(comparison.status)) return { skip: true };
      await loadRuns(comparison);
      const [project, rules] = await Promise.all([
        store.loadProject(comparison.projectId),
        store.loadIgnoreRules(comparison.projectId),
      ]);
      const settings: CompareSettings = {
        threshold: project.diffThreshold,
        changeThresholdPct: project.changeThresholdPct,
        maxPageHeight: project.maxPageHeight,
        checkRedirects: project.checkRedirects,
        ignoreRules: rules.filter(
          (r) =>
            r.enabled !== false &&
            (!r.applies_to || r.applies_to === 'compare' || r.applies_to === 'both'),
        ),
      };
      await store.updateComparison(comparisonId, {
        status: 'running',
        settings,
        started_at: comparison.startedAt ?? now(),
        finished_at: null,
        report_r2_key: null,
      });
      return { skip: false };
    },

    /**
     * Replaces the comparison's items with the matrix (steps 1–3). Re-running is safe: the old
     * items are deleted first. Viewports in one run only are recorded in the settings (info).
     */
    async matrix(): Promise<{ items: number; pending: number; viewports: string[] }> {
      const comparison = await loadComparison();
      const [before, after] = await loadRuns(comparison);
      const [beforeItems, afterItems, settings] = await Promise.all([
        store.listRunItems(before.id),
        store.listRunItems(after.id),
        store.loadSettings(comparisonId),
      ]);
      const { items, matrix } = comparisonItems(comparison, before, after, beforeItems, afterItems);
      await store.deleteItems(comparisonId);
      await store.insertItems(items);
      await store.updateComparison(comparisonId, {
        settings: {
          ...settings,
          viewports: matrix.viewports,
          viewportsNotInBefore: matrix.viewportsNotInBefore,
          viewportsNotInAfter: matrix.viewportsNotInAfter,
        },
      });
      await store.refreshCounts(comparisonId);
      return {
        items: items.length,
        pending: items.filter((i) => i.status === 'pending').length,
        viewports: matrix.viewports,
      };
    },

    /**
     * Redirect check (step 4, 05 §7) once per unique URL of the pending pairs, so all viewports
     * share the result. Skipped when the project disabled it.
     */
    async redirects(): Promise<{ checked: number; redirected: number }> {
      const comparison = await loadComparison();
      const settings = await store.loadSettings(comparisonId);
      if (!settings.checkRedirects) return { checked: 0, redirected: 0 };
      const project = await store.loadProject(comparison.projectId);
      const auth = await deps.basicAuthHeader(project);
      const headers = auth ? { Authorization: auth } : undefined;
      const urls = [...new Set((await store.listPendingPairs(comparisonId)).map((p) => p.url))];
      const targets = await mapLimit(urls, REDIRECT_CHECK_CONCURRENCY, (url) =>
        detectRedirect(url, deps.fetcher, { headers }),
      );
      let redirected = 0;
      for (const [i, to] of targets.entries()) {
        if (!to) continue;
        await store.markRedirect(comparisonId, urls[i]!, to);
        redirected++;
      }
      return { checked: urls.length, redirected };
    },

    /** Sends every pending pair to `vrt-diff` (step 5). Re-sending is safe: final items are skipped. */
    async enqueue(): Promise<{ items: number; messages: number }> {
      const pairs = await store.listPendingPairs(comparisonId);
      const messages = diffBatches(comparisonId, pairs);
      for (let i = 0; i < messages.length; i += SEND_BATCH_LIMIT) {
        await deps.enqueue(messages.slice(i, i + SEND_BATCH_LIMIT));
      }
      return { items: pairs.length, messages: messages.length };
    },

    /** Step 6: settled once no pair waits for its diff. */
    async poll(): Promise<{ settled: boolean; pending: number }> {
      await loadComparison();
      const pending = (await store.listPendingPairs(comparisonId)).length;
      return { settled: pending === 0, pending };
    },

    /** Hard timeout: pairs still waiting become `error`. */
    async timeout(): Promise<void> {
      await store.failPending(comparisonId, TIMEOUT_ERROR);
    },

    /**
     * Step 7: changed items of a URL ignored by a compare rule become `ignored`; items whose
     * after PNG matches a remembered approve/ignore for the same URL and viewport take it over.
     */
    async autoReview(): Promise<{ ignored: number; remembered: number }> {
      const comparison = await loadComparison();
      const [, after] = await loadRuns(comparison);
      const settings = await store.loadSettings(comparisonId);
      const changed = await store.listUnreviewedChanged(comparisonId);
      if (changed.length === 0) return { ignored: 0, remembered: 0 };

      const ignoredIds = changed
        .filter((i) => isUrlIgnored(settings.ignoreRules, i.url, 'compare', i.viewportSlug))
        .map((i) => i.id);
      if (ignoredIds.length > 0) {
        await store.setReview(ignoredIds, 'ignored', 'auto: ignore rule');
      }

      const shaByKey = new Map<string, string>();
      for (const item of await store.listRunItems(after.id)) {
        if (item.sha256 && item.kind === 'page') {
          shaByKey.set(objectKey(after, withLegacyViewport(item)), item.sha256);
        }
      }
      let remembered = 0;
      const skip = new Set(ignoredIds);
      for (const item of changed) {
        const sha = item.afterKey ? shaByKey.get(item.afterKey) : undefined;
        if (skip.has(item.id) || !sha) continue;
        const review = await store.findReviewMemory(
          comparison.projectId,
          item.url,
          item.viewportSlug,
          sha,
        );
        if (review !== 'approved' && review !== 'ignored') continue;
        await store.setReview([item.id], review, `auto: same as ${review} earlier`);
        remembered++;
      }
      await store.refreshCounts(comparisonId);
      return { ignored: ignoredIds.length, remembered };
    },

    /** Step 8: static report under `reports/<label>/index.html` when the project has a public URL. */
    async export(): Promise<{ key: string | null }> {
      const comparison = await loadComparison();
      const project = await store.loadProject(comparison.projectId);
      if (!project.publicUrl) return { key: null };
      const [before, after] = await loadRuns(comparison);
      const settings = await store.loadSettings(comparisonId);
      const html = renderStaticReport(
        {
          label: comparison.label,
          project_name: project.name,
          before_label: before.label,
          after_label: after.label,
          change_threshold_pct: settings.changeThresholdPct,
        },
        await store.listReportItems(comparisonId),
        { publicUrl: project.publicUrl, generatedAt: deps.now?.() },
      );
      const key = reportKey(comparison.label);
      await deps.putReport(project.bucket, key, html);
      await store.updateComparison(comparisonId, { report_r2_key: key });
      return { key };
    },

    /** Step 9: counts, `completed`, audit, notification. Idempotent once final. */
    async finalise(): Promise<{ status: ComparisonStatus; event: CompareEvent | null }> {
      const comparison = await loadComparison();
      if (!ACTIVE_COMPARISON_STATUSES.includes(comparison.status)) {
        return { status: comparison.status, event: null };
      }
      await store.refreshCounts(comparisonId);
      const { counts, review } = await store.loadCounts(comparisonId);
      const event = compareEvent(counts, review);
      await store.updateComparison(comparisonId, { status: 'completed', finished_at: now() });
      await store.audit('comparison.completed', comparison.projectId, {
        comparison_id: comparisonId,
        label: comparison.label,
        ...counts,
      });
      await deps.notifier.notify(event, {
        projectId: comparison.projectId,
        comparisonId,
        label: comparison.label,
      });
      return { status: 'completed', event };
    },

    /** Fatal error: the comparison fails; pairs still waiting become `error`. */
    async fail(error: unknown): Promise<void> {
      const comparison = await store.loadComparison(comparisonId);
      if (!comparison || !ACTIVE_COMPARISON_STATUSES.includes(comparison.status)) return;
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
      await store.failPending(comparisonId, reason);
      await store.refreshCounts(comparisonId);
      await store.updateComparison(comparisonId, { status: 'failed', finished_at: now() });
      await store.audit('comparison.failed', comparison.projectId, {
        comparison_id: comparisonId,
        error: reason,
      });
    },
  };
  return job;
}

export type CompareJob = ReturnType<typeof createCompareJob>;
