import { isRunLabel, runLabelsFromPrefixes, runPrefix } from '@vrt/shared';
import { RequestError } from '../members/errors';

/**
 * Legacy import commands (F-RUN-6). Pure orchestration over `LegacyGateway`, so the rules (only
 * prototype-layout prefixes not yet in the database can be imported) are tested without R2 or a
 * database; `service.ts` wires the gateway to Supabase, R2 and the worker client.
 */

export interface LegacyProject {
  id: string;
  r2Bucket: string;
  archived: boolean;
}

export interface LegacyGateway {
  loadProject(projectId: string): Promise<LegacyProject | null>;
  /** Labels of all runs of the project. */
  runLabels(projectId: string): Promise<string[]>;
  /** Common prefixes directly under `prefix` in the bucket (`screenshots/<ts>/`). */
  listPrefixes(bucket: string, prefix: string): Promise<string[]>;
  startImport(projectId: string, labels: string[]): Promise<{ workflowId: string }>;
  audit(
    action: string,
    projectId: string,
    details: Record<string, string | string[]>,
  ): Promise<void>;
}

export interface LegacyDeps {
  authorize(projectId: string): Promise<void>;
  db: LegacyGateway;
}

export function createLegacyCommands({ authorize, db }: LegacyDeps) {
  async function project(projectId: string): Promise<LegacyProject> {
    await authorize(projectId);
    const row = await db.loadProject(projectId);
    if (!row) throw new RequestError(404, 'not_found', 'Project not found');
    return row;
  }

  /**
   * `screenshots/<ts>/` prefixes without a run in the database whose objects sit directly under
   * the label: runs of the new layout have viewport and `_files` sub-directories (02 §3).
   */
  async function importable(row: LegacyProject): Promise<string[]> {
    const [prefixes, existing] = await Promise.all([
      db.listPrefixes(row.r2Bucket, 'screenshots/'),
      db.runLabels(row.id),
    ]);
    const known = new Set(existing);
    const candidates = runLabelsFromPrefixes(prefixes).filter((label) => !known.has(label));
    const nested = await Promise.all(
      candidates.map(
        async (label) => (await db.listPrefixes(row.r2Bucket, runPrefix(label))).length > 0,
      ),
    );
    return candidates.filter((_, i) => !nested[i]);
  }

  return {
    async listLabels(projectId: string): Promise<{ labels: string[] }> {
      return { labels: await importable(await project(projectId)) };
    },

    async importLabels(projectId: string, labels: string[]): Promise<{ workflowId: string }> {
      const row = await project(projectId);
      if (row.archived) {
        throw new RequestError(422, 'business_rule', 'The project is archived; unarchive it first');
      }
      const wanted = [...new Set(labels)].filter(isRunLabel).sort();
      const available = new Set(await importable(row));
      const unavailable = wanted.filter((label) => !available.has(label));
      if (wanted.length === 0 || unavailable.length > 0) {
        throw new RequestError(
          422,
          'business_rule',
          'Some prefixes are not legacy runs or are already imported',
          { labels: unavailable },
        );
      }
      const { workflowId } = await db.startImport(projectId, wanted);
      await db.audit('run.import_legacy', projectId, { labels: wanted, workflow_id: workflowId });
      return { workflowId };
    },
  };
}
