import {
  summarizeStorage,
  type ObjectEntry,
  type ObjectStore,
  type StorageUsage,
} from '@vrt/shared';

/**
 * `StorageWorkflow(projectId)` steps (F-STORAGE-1, port of prototype `storage.js`): list the
 * project's bucket, total it per top-level prefix and cache the result in `storage_usage`.
 */

export interface StorageStore {
  loadProject(projectId: string): Promise<{ id: string; bucket: string } | null>;
  markRunning(projectId: string, bucket: string, workflowId: string): Promise<void>;
  saveUsage(projectId: string, usage: StorageUsage, refreshedAt: string): Promise<void>;
  markFailed(projectId: string, error: string): Promise<void>;
}

export interface StorageJobDeps {
  store: StorageStore;
  objects: Pick<ObjectStore, 'list'>;
  now?: () => Date;
}

export function createStorageJob(projectId: string, deps: StorageJobDeps) {
  const { store, objects } = deps;
  const now = () => deps.now?.() ?? new Date();

  return {
    /** Returns null when the project no longer exists. */
    async start(workflowId: string): Promise<{ bucket: string } | null> {
      const project = await store.loadProject(projectId);
      if (!project) return null;
      await store.markRunning(projectId, project.bucket, workflowId);
      return { bucket: project.bucket };
    },

    async measure(bucket: string): Promise<StorageUsage> {
      const entries: ObjectEntry[] = [];
      for await (const entry of objects.list(bucket, '')) entries.push(entry);
      const usage = summarizeStorage(entries);
      await store.saveUsage(projectId, usage, now().toISOString());
      return usage;
    },

    async fail(error: unknown): Promise<void> {
      const message = error instanceof Error ? error.message : String(error);
      await store.markFailed(projectId, message.slice(0, 1_000));
    },
  };
}
