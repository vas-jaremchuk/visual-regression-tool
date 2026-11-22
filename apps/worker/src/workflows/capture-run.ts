import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { JOB_POLL_INTERVAL_MS, type CaptureMsg, type StartCaptureJob } from '@vrt/shared';
import { CloudflareBucketAdmin } from '@vrt/storage';
import { createRunJob, MAX_POLLS, type RunJobDeps } from '../capture/run-job';
import { supabaseRunStore } from '../capture/supabase-run-store';
import { getConfig, type Env } from '../env';
import { createLogger } from '../logger';
import { createServiceClient } from '../supabase';

/**
 * `CaptureRunWorkflow(runId)` (06 §2, REQ-JOB-1): prepare, enqueue the pending items to
 * `vrt-capture`, poll until they are final (or the run is cancelled, or 6 h passed), finalise.
 * Retry failed (06 §4) starts a new instance for the same run.
 */

const STEP = {
  retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
  timeout: '5 minutes',
} as const;

export function runJobDeps(env: Env): RunJobDeps {
  const config = getConfig(env);
  const buckets = new CloudflareBucketAdmin({
    accountId: config.CF_ACCOUNT_ID,
    apiToken: config.CF_API_TOKEN,
  });
  return {
    store: supabaseRunStore(createServiceClient(config)),
    ensureBucket: (name) => buckets.ensure(name),
    enqueue: async (messages: CaptureMsg[]) => {
      await env.CAPTURE_QUEUE.sendBatch(messages.map((body) => ({ body })));
    },
  };
}

export class CaptureRunWorkflow extends WorkflowEntrypoint<Env, StartCaptureJob> {
  override async run(event: WorkflowEvent<StartCaptureJob>, step: WorkflowStep) {
    const { runId } = event.payload;
    const log = createLogger({ component: 'workflow', workflow: 'CaptureRunWorkflow', runId });
    const job = createRunJob(runId, runJobDeps(this.env));

    try {
      const prepared = await step.do('prepare', STEP, () => job.prepare());
      if (prepared.skip) {
        log.info('run is already final; nothing to do');
        return;
      }
      const enqueued = await step.do('enqueue', STEP, () => job.enqueue());
      log.info('items enqueued', { step: 'enqueue', ...enqueued });

      let finished = false;
      for (let i = 0; i < MAX_POLLS && !finished; i++) {
        await step.sleep(`wait ${i}`, JOB_POLL_INTERVAL_MS);
        const state = await step.do(`poll ${i}`, STEP, () => job.poll());
        finished = state.settled || state.cancelRequested;
      }
      if (!finished) {
        log.warn('run timed out', { step: 'timeout' });
        await step.do('timeout', STEP, () => job.timeout());
      }
      const { status } = await step.do('finalise', STEP, () => job.finalise());
      log.info('run finished', { step: 'finalise', status });
    } catch (error) {
      log.error('capture workflow failed', { error });
      await step.do('mark failed', STEP, () => job.fail(error));
      throw error;
    }
  }
}
