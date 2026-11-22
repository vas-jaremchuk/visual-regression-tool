import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { DeleteJob } from '@vrt/shared';
import { R2ObjectStore } from '@vrt/storage';
import { createDeleteJob, type DeleteJobDeps } from '../delete/delete-job';
import { supabaseDeleteStore } from '../delete/supabase-delete-store';
import { getConfig, type Env } from '../env';
import { createLogger } from '../logger';
import { createServiceClient } from '../supabase';

/**
 * `DeleteWorkflow(entity, id)` (06 §1, F-STORAGE-3): plan, batch-delete the R2 objects, then the
 * DB rows. A failure leaves the rows with status `delete_failed`; deleting again retries.
 */

const STEP = {
  retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
  timeout: '10 minutes',
} as const;

export function deleteJobDeps(env: Env): DeleteJobDeps {
  const config = getConfig(env);
  return {
    store: supabaseDeleteStore(createServiceClient(config)),
    objects: new R2ObjectStore({
      accountId: config.CF_ACCOUNT_ID,
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    }),
  };
}

export class DeleteWorkflow extends WorkflowEntrypoint<Env, DeleteJob> {
  override async run(event: WorkflowEvent<DeleteJob>, step: WorkflowStep) {
    const { entity, id } = event.payload;
    const log = createLogger({ component: 'workflow', workflow: 'DeleteWorkflow', entity, id });
    const job = createDeleteJob(event.payload, deleteJobDeps(this.env));

    try {
      const plan = await step.do('plan', STEP, () => job.plan());
      if (plan.skip) {
        log.info('nothing to delete; the entity is gone');
        return;
      }
      const { objects } = await step.do('delete objects', STEP, () => job.deleteObjects(plan));
      log.info('objects deleted', { step: 'delete objects', objects });
      await step.do('delete rows', STEP, () => job.deleteRows(plan, objects));
      log.info('rows deleted', { step: 'delete rows' });
    } catch (error) {
      log.error('delete workflow failed', { error });
      await step.do('mark failed', STEP, () => job.fail(error));
      throw error;
    }
  }
}
