import { WorkflowEntrypoint, type WorkflowEvent } from 'cloudflare:workers';
import type { StartCaptureJob, StartCompareJob, StartSitemapJob } from '@vrt/shared';
import type { Env } from '../env';
import { createLogger } from '../logger';

/**
 * Workflow classes bound in `wrangler.jsonc` (03 §3). They are stubs so the bindings deploy;
 * the durable step sequences arrive with their job tickets (T10 sitemap, T12 capture, T15 compare).
 */

const log = createLogger({ component: 'workflow' });

export class SitemapWorkflow extends WorkflowEntrypoint<Env, StartSitemapJob> {
  override async run(event: WorkflowEvent<StartSitemapJob>) {
    log.info('stub workflow run', { workflow: 'SitemapWorkflow', ...event.payload });
  }
}

export class CaptureRunWorkflow extends WorkflowEntrypoint<Env, StartCaptureJob> {
  override async run(event: WorkflowEvent<StartCaptureJob>) {
    log.info('stub workflow run', { workflow: 'CaptureRunWorkflow', ...event.payload });
  }
}

export class CompareWorkflow extends WorkflowEntrypoint<Env, StartCompareJob> {
  override async run(event: WorkflowEvent<StartCompareJob>) {
    log.info('stub workflow run', { workflow: 'CompareWorkflow', ...event.payload });
  }
}
