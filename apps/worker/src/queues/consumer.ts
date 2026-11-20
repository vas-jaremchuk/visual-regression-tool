import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@vrt/db';
import { captureMsg, decryptSecret, type WorkerEnv } from '@vrt/shared';
import { R2ObjectStore } from '@vrt/storage';
import { BrowserRenderingProvider } from '../capture/browser-rendering-provider';
import { processCaptureMessage, type CaptureDeps } from '../capture/consumer';
import { CaptureRepo } from '../capture/repo';
import type { Env } from '../env';
import { durableLimiter } from '../limiter/limiter';
import { createLogger, type Logger } from '../logger';
import { createServiceClient } from '../supabase';

/**
 * Queue consumer for `vrt-capture` and `vrt-diff` (03 §3). `vrt-diff` is still a stub that
 * acknowledges every message; diff dispatch (T15) replaces it.
 */

const log = createLogger({ component: 'queue' });

export const CAPTURE_QUEUE_NAME = 'vrt-capture';

export async function handleQueue(
  batch: MessageBatch<unknown>,
  env: Env,
  config: WorkerEnv,
): Promise<void> {
  if (batch.queue === CAPTURE_QUEUE_NAME) {
    await handleCaptureBatch(batch, captureDeps(env, config));
    return;
  }
  log.info('stub queue batch', { queue: batch.queue, messages: batch.messages.length });
  batch.ackAll();
}

/**
 * Messages run in parallel: each holds at most one browser session and its own limiter slot.
 * A message that throws is retried by the queue (`max_retries`, then the DLQ, 06 §8).
 */
export async function handleCaptureBatch(
  batch: MessageBatch<unknown>,
  deps: CaptureDeps,
): Promise<void> {
  await Promise.all(
    batch.messages.map(async (message) => {
      const parsed = captureMsg.safeParse(message.body);
      if (!parsed.success) {
        deps.log.error('invalid capture message; dropped', {
          messageId: message.id,
          issues: parsed.error.issues,
        });
        message.ack();
        return;
      }
      try {
        await processCaptureMessage(parsed.data, deps);
        message.ack();
      } catch (err) {
        deps.log.error('capture message failed; will be retried', {
          messageId: message.id,
          runId: parsed.data.runId,
          attempts: message.attempts,
          err,
        });
        message.retry();
      }
    }),
  );
}

function captureDeps(env: Env, config: WorkerEnv, logger: Logger = log): CaptureDeps {
  return {
    repo: new CaptureRepo(createServiceClient(config) as SupabaseClient<Database>),
    browser: new BrowserRenderingProvider(env.BROWSER, logger),
    store: new R2ObjectStore({
      accountId: config.CF_ACCOUNT_ID,
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    }),
    limiter: durableLimiter(env.PROJECT_LIMITER),
    fetcher: fetch,
    enqueue: async (msg, delaySeconds) => {
      await env.CAPTURE_QUEUE.send(msg, { delaySeconds });
    },
    decrypt: (payload) => decryptSecret(payload, config.SETTINGS_ENCRYPTION_KEY),
    log: logger,
  };
}
