import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { StartSitemapJob } from '@vrt/shared';
import { getConfig, type Env } from '../env';
import { createLogger } from '../logger';
import { CHECK_BATCH_SIZE, createSitemapJob, SnapshotFailedError } from '../sitemap/sitemap-job';
import { supabaseSitemapStore } from '../sitemap/supabase-store';
import { ssrfOptions } from '../ssrf';
import { createServiceClient } from '../supabase';

/**
 * `SitemapWorkflow(snapshotId)` (06 §1, 05 §3): fetch the sitemap, redirect-check the URLs in
 * batches (one durable step each, so progress survives restarts), then complete the snapshot.
 * Any failure marks the snapshot `failed` with the reason.
 */

const STEP = {
  retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
  timeout: '10 minutes',
} as const;

export class SitemapWorkflow extends WorkflowEntrypoint<Env, StartSitemapJob> {
  override async run(event: WorkflowEvent<StartSitemapJob>, step: WorkflowStep) {
    const { snapshotId } = event.payload;
    const log = createLogger({ component: 'workflow', workflow: 'SitemapWorkflow', snapshotId });
    const config = getConfig(this.env);
    const job = createSitemapJob(snapshotId, {
      store: supabaseSitemapStore(createServiceClient(config)),
      fetch: (input, init) => fetch(input, init),
      ssrf: ssrfOptions(config),
      encryptionKeys: config.SETTINGS_ENCRYPTION_KEY,
    });

    try {
      const fetched = await step.do('fetch sitemap', STEP, async () => {
        try {
          return await job.fetch();
        } catch (error) {
          // An unreachable or invalid sitemap is a result, not a transient error.
          if (error instanceof SnapshotFailedError) return { failed: error.message };
          throw error;
        }
      });
      if ('failed' in fetched) {
        await step.do('mark failed', STEP, () => job.fail(new Error(fetched.failed)));
        log.warn('sitemap fetch failed', { error: fetched.failed });
        return;
      }
      if (fetched.skipped) return;
      log.info('sitemap fetched', { total: fetched.total, toCheck: fetched.toCheck });

      for (let offset = 0; offset < fetched.toCheck; offset += CHECK_BATCH_SIZE) {
        await step.do(`check urls ${offset}`, STEP, () => job.checkBatch(offset));
      }
      await step.do('finish', STEP, () => job.finish(fetched.toCheck > 0));
      log.info('sitemap snapshot completed');
    } catch (error) {
      log.error('sitemap workflow failed', { error });
      await step.do('mark failed', STEP, () => job.fail(error));
      throw error;
    }
  }
}
