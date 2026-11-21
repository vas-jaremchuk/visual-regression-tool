import {
  basicAuthHeader,
  buildSnapshotUrls,
  checkRedirects,
  fetchSitemap,
  mergeManualUrls,
  snapshotCounts,
  type IgnoreRule,
  type SnapshotUrl,
} from '@vrt/engine';
import { decryptSecret, guardedFetch, type SsrfGuardOptions } from '@vrt/shared';

/**
 * Sitemap snapshot job (05 §3, F-SITEMAP-1/4, NFR-14). The workflow runs `fetch`, then
 * `checkBatch` until every URL is checked, then `finish`; each is one durable step, so state
 * lives in the database between them, never in step outputs.
 */

export interface SnapshotRow {
  id: string;
  projectId: string;
  status: 'running' | 'completed' | 'failed';
  sourceUrl: string;
}

export interface SitemapProject {
  checkRedirects: boolean;
  basicAuthUser: string | null;
  basicAuthPassEnc: string | null;
  fileExtensions: string[] | null;
}

export interface SnapshotPatch {
  status?: 'completed' | 'failed';
  child_sitemaps?: number;
  url_count?: number;
  redirect_count?: number;
  error_count?: number;
  error?: string | null;
  urls_checked?: number;
  urls_total?: number;
  finished_at?: string;
}

/** Database access the job needs (service role in production, in-memory in tests). */
export interface SitemapStore {
  loadSnapshot(snapshotId: string): Promise<SnapshotRow | null>;
  loadProject(projectId: string): Promise<SitemapProject>;
  loadManualUrls(projectId: string): Promise<string[]>;
  loadIgnoreRules(projectId: string): Promise<IgnoreRule[]>;
  updateSnapshot(snapshotId: string, patch: SnapshotPatch): Promise<void>;
  /** Inserts or replaces rows by (`snapshot_id`, `url`). */
  upsertUrls(snapshotId: string, rows: SnapshotUrl[]): Promise<void>;
  /** Rows sorted by URL; `offset`/`limit` page through them. */
  listUrls(snapshotId: string, offset?: number, limit?: number): Promise<SnapshotUrl[]>;
}

export interface SitemapJobDeps {
  store: SitemapStore;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  ssrf: SsrfGuardOptions;
  encryptionKeys: string;
}

/** URLs redirect-checked per durable step. */
export const CHECK_BATCH_SIZE = 200;

function countColumns(rows: SnapshotUrl[], checked: boolean): SnapshotPatch {
  const counts = snapshotCounts(rows, checked);
  return {
    url_count: counts.urlCount,
    redirect_count: counts.redirectCount,
    error_count: counts.errorCount,
  };
}

export class SnapshotFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotFailedError';
  }
}

export function createSitemapJob(snapshotId: string, deps: SitemapJobDeps) {
  const { store } = deps;
  const fetcher = guardedFetch(deps.fetch, deps.ssrf) as typeof fetch;

  async function context() {
    const snapshot = await store.loadSnapshot(snapshotId);
    if (!snapshot) throw new SnapshotFailedError(`Snapshot ${snapshotId} not found`);
    const project = await store.loadProject(snapshot.projectId);
    const headers: Record<string, string> = {};
    if (project.basicAuthUser && project.basicAuthPassEnc) {
      const pass = await decryptSecret(project.basicAuthPassEnc, deps.encryptionKeys);
      headers.Authorization = basicAuthHeader(project.basicAuthUser, pass);
    }
    return { snapshot, project, headers };
  }

  return {
    /**
     * Fetches the sitemap (and child sitemaps), merges manual URLs, applies ignore rules and
     * stores every URL. Returns how many URLs the redirect check has to look at (0 when off).
     */
    async fetch(): Promise<{ skipped: boolean; total: number; toCheck: number }> {
      const { snapshot, project, headers } = await context();
      // A retried workflow must not reopen a snapshot that already finished.
      if (snapshot.status !== 'running') return { skipped: true, total: 0, toCheck: 0 };
      const result = await fetchSitemap(snapshot.sourceUrl, { fetcher, headers });
      if (!result.ok) throw new SnapshotFailedError(result.error);

      const [manual, rules] = await Promise.all([
        store.loadManualUrls(snapshot.projectId),
        store.loadIgnoreRules(snapshot.projectId),
      ]);
      const rows = buildSnapshotUrls(mergeManualUrls(result.urls, manual), {
        ignoreRules: rules,
        fileExtensions: project.fileExtensions,
      });
      await store.upsertUrls(snapshotId, rows);
      const toCheck = project.checkRedirects ? rows.length : 0;
      await store.updateSnapshot(snapshotId, {
        child_sitemaps: result.childSitemaps,
        urls_total: toCheck,
        urls_checked: 0,
        ...countColumns(rows, false),
        error: result.childErrors.length
          ? `Child sitemaps failed: ${result.childErrors.map((e) => `${e.url} (${e.error})`).join('; ')}`
          : null,
      });
      return { skipped: false, total: rows.length, toCheck };
    },

    /** Redirect-checks the rows `[offset, offset + limit)` (05 §3 step 6) and records progress. */
    async checkBatch(offset: number, limit = CHECK_BATCH_SIZE): Promise<number> {
      const { headers } = await context();
      const rows = await store.listUrls(snapshotId, offset, limit);
      const checks = new Map(
        (
          await checkRedirects(
            rows.map((r) => r.url),
            { fetcher, headers },
          )
        ).map((c) => [c.url, c]),
      );
      await store.upsertUrls(
        snapshotId,
        rows.map((row) => {
          const check = checks.get(row.url)!;
          return {
            ...row,
            httpStatus: check.httpStatus,
            redirectTo: check.redirectTo,
            included: row.included && check.included,
          };
        }),
      );
      await store.updateSnapshot(snapshotId, { urls_checked: offset + rows.length });
      return rows.length;
    },

    /** Recomputes the counts from the stored rows and completes the snapshot. */
    async finish(checked: boolean): Promise<void> {
      const rows = await store.listUrls(snapshotId);
      await store.updateSnapshot(snapshotId, {
        ...countColumns(rows, checked),
        status: 'completed',
        finished_at: new Date().toISOString(),
      });
    },

    async fail(error: unknown): Promise<void> {
      await store.updateSnapshot(snapshotId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        finished_at: new Date().toISOString(),
      });
    },
  };
}

/** Runs every step in order without durability (tests and local tooling). */
export async function runSitemapJob(snapshotId: string, deps: SitemapJobDeps): Promise<void> {
  const job = createSitemapJob(snapshotId, deps);
  try {
    const { skipped, toCheck } = await job.fetch();
    if (skipped) return;
    for (let offset = 0; offset < toCheck; offset += CHECK_BATCH_SIZE) {
      await job.checkBatch(offset);
    }
    await job.finish(toCheck > 0);
  } catch (error) {
    await job.fail(error);
  }
}
