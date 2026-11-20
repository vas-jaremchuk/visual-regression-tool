/** Small runtime-agnostic helpers shared by the engine modules. */

export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `fn` over `items` with at most `limit` calls in flight; results keep input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** `Authorization` header value for HTTP basic auth (UTF-8 safe). */
export function basicAuthHeader(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return 'Basic ' + btoa(binary);
}

/** Discards a response body without reading it. */
export async function discardBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // ignore: the body is not needed
  }
}

export function errorReason(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown; cause?: { code?: unknown } };
    if (typeof e.code === 'string' && e.code) return e.code;
    if (typeof e.cause?.code === 'string' && e.cause.code) return e.cause.code;
    if (typeof e.message === 'string' && e.message) return e.message;
  }
  return String(err);
}
