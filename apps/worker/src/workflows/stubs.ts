import { WorkflowEntrypoint, type WorkflowEvent } from 'cloudflare:workers';
import type { StartCompareJob } from '@vrt/shared';
import type { Env } from '../env';
import { createLogger } from '../logger';

/**
 * Workflow classes bound in `wrangler.jsonc` (03 §3). They are stubs so the bindings deploy;
 * the durable step sequence arrives with its job ticket (T15 compare).
 * `SitemapWorkflow` lives in `./sitemap`, `CaptureRunWorkflow` in `./capture-run`.
 */

const log = createLogger({ component: 'workflow' });

export class CompareWorkflow extends WorkflowEntrypoint<Env, StartCompareJob> {
  override async run(event: WorkflowEvent<StartCompareJob>) {
    log.info('stub workflow run', { workflow: 'CompareWorkflow', ...event.payload });
  }
}
