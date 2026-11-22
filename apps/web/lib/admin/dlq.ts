import { CLOUDFLARE_API_BASE } from '@vrt/storage';

/** Dead letter queues of the worker's consumers (03 §4, `apps/worker/wrangler.jsonc`). */
export const DEAD_LETTER_QUEUES = ['vrt-capture-dlq', 'vrt-diff-dlq'] as const;

const TIMEOUT_MS = 5_000;

export interface DlqCount {
  queue: string;
  /** Unacknowledged messages, or null when the queue does not exist or could not be read. */
  messages: number | null;
  oldestMessageAt: string | null;
  error?: string;
}

export interface DlqDeps {
  accountId: string;
  apiToken: string;
  fetch: typeof fetch;
  apiBase?: string;
}

interface Envelope<T> {
  success: boolean;
  result: T;
  errors?: { message?: string }[];
  result_info?: { total_pages?: number };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * DLQ message counts via the Cloudflare Queues API (06 §8): list the account's queues to find the
 * DLQ ids, then read each queue's backlog metrics. Failures are reported per queue so the page
 * still renders.
 */
export async function fetchDlqCounts(deps: DlqDeps): Promise<DlqCount[]> {
  const base = `${(deps.apiBase ?? CLOUDFLARE_API_BASE).replace(/\/+$/, '')}/accounts/${encodeURIComponent(deps.accountId)}/queues`;
  const call = async <T>(url: string): Promise<Envelope<T>> => {
    const res = await deps.fetch(url, {
      headers: { Authorization: `Bearer ${deps.apiToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (!res.ok || !body?.success) {
      const detail = body?.errors?.map((e) => e.message).join('; ') || res.statusText;
      throw new Error(`Cloudflare API ${res.status}: ${detail}`);
    }
    return body;
  };

  const ids = new Map<string, string>();
  try {
    for (let page = 1; ; page++) {
      const body = await call<{ queue_id: string; queue_name: string }[]>(
        `${base}?per_page=100&page=${page}`,
      );
      for (const queue of body.result) ids.set(queue.queue_name, queue.queue_id);
      if (body.result.length === 0 || page >= (body.result_info?.total_pages ?? 1)) break;
    }
  } catch (error) {
    const reason = `Could not list queues: ${message(error)}`;
    return DEAD_LETTER_QUEUES.map((queue) => ({
      queue,
      messages: null,
      oldestMessageAt: null,
      error: reason,
    }));
  }

  return Promise.all(
    DEAD_LETTER_QUEUES.map(async (queue): Promise<DlqCount> => {
      const id = ids.get(queue);
      if (!id) return { queue, messages: null, oldestMessageAt: null, error: 'Queue not found' };
      try {
        const { result: metrics } = await call<{
          backlog_count?: number;
          oldest_message_timestamp_ms?: number;
        }>(`${base}/${encodeURIComponent(id)}/metrics`);
        const count = metrics.backlog_count ?? 0;
        const oldest = metrics.oldest_message_timestamp_ms;
        return {
          queue,
          messages: count,
          oldestMessageAt: count > 0 && oldest ? new Date(oldest).toISOString() : null,
        };
      } catch (error) {
        return { queue, messages: null, oldestMessageAt: null, error: message(error) };
      }
    }),
  );
}
