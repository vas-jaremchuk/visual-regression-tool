import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { ImportLegacyJob } from '@vrt/shared';
import { R2ObjectStore } from '@vrt/storage';
import { getConfig, type Env } from '../env';
import { createImportJob } from '../legacy/import-job';
import { supabaseImportStore } from '../legacy/supabase-store';
import { createLogger } from '../logger';
import { createServiceClient } from '../supabase';

/**
 * `ImportWorkflow(projectId)` (06 §1, F-RUN-6): imports each selected legacy prefix as one durable
 * step, so a restart neither repeats a finished label nor loses one.
 */

const STEP = {
  retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
  timeout: '10 minutes',
} as const;

export class ImportWorkflow extends WorkflowEntrypoint<Env, ImportLegacyJob> {
  override async run(event: WorkflowEvent<ImportLegacyJob>, step: WorkflowStep) {
    const { projectId, labels } = event.payload;
    const log = createLogger({ component: 'workflow', workflow: 'ImportWorkflow', projectId });
    const config = getConfig(this.env);
    const job = createImportJob(projectId, {
      store: supabaseImportStore(createServiceClient(config)),
      objects: new R2ObjectStore({
        accountId: config.CF_ACCOUNT_ID,
        accessKeyId: config.R2_ACCESS_KEY_ID,
        secretAccessKey: config.R2_SECRET_ACCESS_KEY,
      }),
    });

    for (const label of labels) {
      const result = await step.do(`import ${label}`, STEP, () => job.importLabel(label));
      log.info('legacy label processed', { ...result });
    }
  }
}
