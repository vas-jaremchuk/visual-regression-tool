import { buildLegacyRunItems, legacyPageUrls, type LegacyRunItem } from '@vrt/engine';
import { LEGACY_VIEWPORT_SLUG, runPrefix, type ObjectStore } from '@vrt/shared';

/**
 * Legacy import job (F-RUN-6, 06 §1 `ImportWorkflow`): each selected `screenshots/<ts>/` prefix
 * of the project bucket becomes a completed `is_legacy` run. The workflow runs `importLabel` once
 * per label as a durable step; a label that already has a finished run is skipped.
 */

export interface ImportProject {
  id: string;
  r2Bucket: string;
  fileExtensions: string[] | null;
}

export interface ExistingRun {
  id: string;
  isLegacy: boolean;
  status: string;
}

export interface NewLegacyRun {
  projectId: string;
  label: string;
  startedAt: string | null;
}

export interface LegacyRunPatch {
  status: 'completed';
  viewport_slugs: string[];
  finished_at: string;
}

/** Database access the job needs (service role in production, in-memory in tests). */
export interface ImportStore {
  loadProject(projectId: string): Promise<ImportProject | null>;
  findRun(projectId: string, label: string): Promise<ExistingRun | null>;
  /** URLs of the project's latest completed sitemap snapshot (empty without one). */
  latestSnapshotUrls(
    projectId: string,
  ): Promise<{ url: string; kind: 'page' | 'file'; included: boolean }[]>;
  /** Inserts a `running` legacy run and returns its id. */
  createRun(run: NewLegacyRun): Promise<{ id: string }>;
  deleteItems(runId: string): Promise<void>;
  insertItems(runId: string, items: LegacyRunItem[], finishedAt: string): Promise<void>;
  updateRun(runId: string, patch: LegacyRunPatch): Promise<void>;
  refreshCounts(runId: string): Promise<void>;
}

export interface ImportJobDeps {
  store: ImportStore;
  objects: ObjectStore;
  now?: () => Date;
}

export type ImportLabelResult =
  | { label: string; imported: true; runId: string; pages: number; files: number; skipped: number }
  | { label: string; imported: false; reason: string };

export class ImportProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} not found`);
    this.name = 'ImportProjectNotFoundError';
  }
}

/** Fingerprint files read in parallel. */
const READ_CONCURRENCY = 8;

/** `YYYY-MM-DD_HH-MM-SS[-n]` → ISO timestamp of the prototype run (UTC). */
export function labelTime(label: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/.exec(label);
  if (!m) return null;
  const date = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function createImportJob(projectId: string, deps: ImportJobDeps) {
  const { store, objects } = deps;
  const now = deps.now ?? (() => new Date());

  async function project(): Promise<ImportProject> {
    const row = await store.loadProject(projectId);
    if (!row) throw new ImportProjectNotFoundError(projectId);
    return row;
  }

  async function readFingerprints(bucket: string, keys: string[]): Promise<Map<string, string>> {
    const texts = new Map<string, string>();
    const decoder = new TextDecoder();
    for (let i = 0; i < keys.length; i += READ_CONCURRENCY) {
      await Promise.all(
        keys.slice(i, i + READ_CONCURRENCY).map(async (key) => {
          texts.set(key, decoder.decode(await objects.get(bucket, key)));
        }),
      );
    }
    return texts;
  }

  return {
    async importLabel(label: string): Promise<ImportLabelResult> {
      const { r2Bucket, fileExtensions } = await project();
      const existing = await store.findRun(projectId, label);
      // A legacy run left `running` is an earlier attempt of this step: import it again.
      if (existing && !(existing.isLegacy && existing.status === 'running')) {
        return { label, imported: false, reason: 'A run with this label already exists' };
      }

      const listed: { key: string; size: number }[] = [];
      for await (const entry of objects.list(r2Bucket, runPrefix(label), { delimiter: '/' })) {
        listed.push(entry);
      }
      const plan = buildLegacyRunItems({
        label,
        objects: listed,
        fingerprints: await readFingerprints(
          r2Bucket,
          listed.map((o) => o.key).filter((key) => /\.txt$/i.test(key)),
        ),
        pageUrls: legacyPageUrls(await store.latestSnapshotUrls(projectId)),
        fileExtensions,
      });
      if (plan.items.length === 0) {
        return { label, imported: false, reason: 'No screenshots or fingerprints found' };
      }

      let runId: string;
      if (existing) {
        runId = existing.id;
        await store.deleteItems(runId);
      } else {
        runId = (await store.createRun({ projectId, label, startedAt: labelTime(label) })).id;
      }
      const finishedAt = now().toISOString();
      await store.insertItems(runId, plan.items, finishedAt);
      const pages = plan.items.filter((i) => i.kind === 'page').length;
      await store.updateRun(runId, {
        status: 'completed',
        viewport_slugs: pages > 0 ? [LEGACY_VIEWPORT_SLUG] : [],
        finished_at: finishedAt,
      });
      await store.refreshCounts(runId);
      return {
        label,
        imported: true,
        runId,
        pages,
        files: plan.items.length - pages,
        skipped: plan.skipped.length,
      };
    },
  };
}

export type ImportJob = ReturnType<typeof createImportJob>;
