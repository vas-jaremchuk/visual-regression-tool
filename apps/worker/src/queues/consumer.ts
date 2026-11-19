import { createLogger } from '../logger';

/**
 * Queue consumer for `vrt-capture` and `vrt-diff` (03 §3). Stub: acknowledges every message so
 * nothing piles up in the DLQs. Capture (T11) and diff dispatch (T15) replace the branches.
 */

const log = createLogger({ component: 'queue' });

export async function handleQueue(batch: MessageBatch<unknown>): Promise<void> {
  log.info('stub queue batch', { queue: batch.queue, messages: batch.messages.length });
  batch.ackAll();
}
