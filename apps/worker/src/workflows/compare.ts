import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { basicAuthHeader } from '@vrt/engine';
import {
  JOB_POLL_INTERVAL_MS,
  decryptSecret,
  guardedFetch,
  type DiffMsg,
  type StartCompareJob,
} from '@vrt/shared';
import { R2ObjectStore } from '@vrt/storage';
import { createCompareJob, MAX_POLLS, type CompareJobDeps } from '../compare/compare-job';
import { supabaseCompareStore } from '../compare/supabase-compare-store';
import { getConfig, type Env } from '../env';
import { createLogger } from '../logger';
import { projectNotifier } from '../notify';
import { ssrfOptions } from '../ssrf';
import { createServiceClient } from '../supabase';

/**
 * `CompareWorkflow(comparisonId)` (06 §5, REQ-JOB-4): prepare, matrix (with files), redirects,
 * enqueue the pairs to `vrt-diff`, poll until they are diffed (or 6 h passed), auto-review,
 * export, finalise. Re-running the same pair starts a new instance that replaces the items.
 */

const STEP = {
  retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
  timeout: '10 minutes',
} as const;

export function compareJobDeps(env: Env): CompareJobDeps {
  const config = getConfig(env);
  const objects = new R2ObjectStore({
    accountId: config.CF_ACCOUNT_ID,
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
  });
  const notifier = projectNotifier(env);
  return {
    store: supabaseCompareStore(createServiceClient(config)),
    fetcher: guardedFetch((input, init) => fetch(input, init), ssrfOptions(config)) as typeof fetch,
    basicAuthHeader: async (project) => {
      if (!project.basicAuthUser || !project.basicAuthPassEnc) return null;
      const password = await decryptSecret(
        project.basicAuthPassEnc,
        config.SETTINGS_ENCRYPTION_KEY,
      );
      return basicAuthHeader(project.basicAuthUser, password);
    },
    enqueue: async (messages: DiffMsg[]) => {
      await env.DIFF_QUEUE.sendBatch(messages.map((body) => ({ body })));
    },
    putReport: (bucket, key, html) =>
      objects.put(bucket, key, new TextEncoder().encode(html), 'text/html; charset=utf-8'),
    notifier: {
      notify: (event, { projectId, comparisonId }) =>
        notifier.comparison(event, { projectId, comparisonId }),
    },
  };
}

export class CompareWorkflow extends WorkflowEntrypoint<Env, StartCompareJob> {
  override async run(event: WorkflowEvent<StartCompareJob>, step: WorkflowStep) {
    const { comparisonId } = event.payload;
    const log = createLogger({ component: 'workflow', workflow: 'CompareWorkflow', comparisonId });
    const job = createCompareJob(comparisonId, compareJobDeps(this.env));

    try {
      const prepared = await step.do('prepare', STEP, () => job.prepare());
      if (prepared.skip) {
        log.info('comparison is already final; nothing to do');
        return;
      }
      const matrix = await step.do('matrix', STEP, () => job.matrix());
      log.info('matrix built', { step: 'matrix', ...matrix });
      const redirects = await step.do('redirects', STEP, () => job.redirects());
      log.info('redirects checked', { step: 'redirects', ...redirects });
      const enqueued = await step.do('enqueue', STEP, () => job.enqueue());
      log.info('pairs enqueued', { step: 'enqueue', ...enqueued });

      let settled = enqueued.items === 0;
      for (let i = 0; i < MAX_POLLS && !settled; i++) {
        await step.sleep(`wait ${i}`, JOB_POLL_INTERVAL_MS);
        settled = (await step.do(`poll ${i}`, STEP, () => job.poll())).settled;
      }
      if (!settled) {
        log.warn('comparison timed out', { step: 'timeout' });
        await step.do('timeout', STEP, () => job.timeout());
      }
      await step.do('auto-review', STEP, () => job.autoReview());
      await step.do('export', STEP, () => job.export());
      const { status, event: notified } = await step.do('finalise', STEP, () => job.finalise());
      log.info('comparison finished', { step: 'finalise', status, event: notified });
    } catch (error) {
      log.error('compare workflow failed', { error });
      await step.do('mark failed', STEP, () => job.fail(error));
      throw error;
    }
  }
}
