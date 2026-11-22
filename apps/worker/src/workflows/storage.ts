import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { StorageJob } from '@vrt/shared';
import { R2ObjectStore } from '@vrt/storage';
import { supabaseStorageStore } from '../delete/supabase-delete-store';
import { getConfig, type Env } from '../env';
import { createLogger } from '../logger';
import { createStorageJob, type StorageJobDeps } from '../storage/storage-job';
import { createServiceClient } from '../supabase';

/** `StorageWorkflow(projectId)` (F-STORAGE-1): list the bucket and cache the totals per prefix. */

const STEP = {
  retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
  timeout: '10 minutes',
} as const;

export function storageJobDeps(env: Env): StorageJobDeps {
  const config = getConfig(env);
  return {
    store: supabaseStorageStore(createServiceClient(config)),
    objects: new R2ObjectStore({
      accountId: config.CF_ACCOUNT_ID,
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    }),
  };
}

export class StorageWorkflow extends WorkflowEntrypoint<Env, StorageJob> {
  override async run(event: WorkflowEvent<StorageJob>, step: WorkflowStep) {
    const { projectId } = event.payload;
    const log = createLogger({ component: 'workflow', workflow: 'StorageWorkflow', projectId });
    const job = createStorageJob(projectId, storageJobDeps(this.env));

    try {
      const started = await step.do('start', STEP, () => job.start(event.instanceId));
      if (!started) {
        log.info('project is gone; nothing to measure');
        return;
      }
      const usage = await step.do('measure', STEP, () => job.measure(started.bucket));
      log.info('storage measured', {
        step: 'measure',
        totalBytes: usage.totalBytes,
        objectCount: usage.objectCount,
      });
    } catch (error) {
      log.error('storage workflow failed', { error });
      await step.do('mark failed', STEP, () => job.fail(error));
      throw error;
    }
  }
}
