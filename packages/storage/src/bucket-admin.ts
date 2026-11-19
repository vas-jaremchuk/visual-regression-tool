import { StorageError } from './errors';
import { fetchWithRetry, type RetryOptions } from './retry';

export const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

export interface BucketInfo {
  name: string;
  creationDate: string | null;
  location: string | null;
}

export interface BucketAdmin {
  exists(name: string): Promise<boolean>;
  /** Creates the bucket unless it exists; a concurrent create (409) counts as existing. */
  ensure(name: string): Promise<{ created: boolean }>;
  list(): Promise<BucketInfo[]>;
}

export interface CloudflareBucketAdminOptions extends RetryOptions {
  accountId: string;
  apiToken: string;
  /** Defaults to `CLOUDFLARE_API_BASE`. */
  apiBase?: string;
}

interface ApiBucket {
  name: string;
  creation_date?: string;
  location?: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  errors?: { code: number; message: string }[];
  result: T;
  result_info?: { cursor?: string };
}

/** Bucket lifecycle over the Cloudflare REST API with `CF_API_TOKEN` (ADR-3, prototype `ensureBucket`). */
export class CloudflareBucketAdmin implements BucketAdmin {
  private readonly base: string;
  private readonly apiToken: string;
  private readonly retry: RetryOptions;

  constructor(options: CloudflareBucketAdminOptions) {
    const { accountId, apiToken, apiBase, ...retry } = options;
    this.base = `${(apiBase ?? CLOUDFLARE_API_BASE).replace(/\/+$/, '')}/accounts/${encodeURIComponent(accountId)}/r2/buckets`;
    this.apiToken = apiToken;
    this.retry = retry;
  }

  async exists(name: string): Promise<boolean> {
    const operation = `R2 bucket check ${name}`;
    const res = await this.send(operation, `${this.base}/${encodeURIComponent(name)}`, {
      method: 'GET',
    });
    await res.body?.cancel();
    if (res.ok) return true;
    if (res.status === 404) return false;
    throw new StorageError(`${operation} failed: ${res.status}`, { status: res.status });
  }

  async ensure(name: string): Promise<{ created: boolean }> {
    if (await this.exists(name)) return { created: false };
    const operation = `R2 bucket create ${name}`;
    const res = await this.send(operation, this.base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (res.status === 409) {
      await res.body?.cancel();
      return { created: false };
    }
    if (!res.ok) throw await StorageError.fromResponse(operation, res);
    await res.body?.cancel();
    return { created: true };
  }

  async list(): Promise<BucketInfo[]> {
    const operation = 'R2 bucket list';
    const buckets: BucketInfo[] = [];
    let cursor: string | undefined;
    do {
      const url = new URL(this.base);
      url.searchParams.set('per_page', '1000');
      if (cursor) url.searchParams.set('cursor', cursor);
      const res = await this.send(operation, url, { method: 'GET' });
      if (!res.ok) throw await StorageError.fromResponse(operation, res);
      const data = (await res.json()) as ApiEnvelope<{ buckets?: ApiBucket[] }>;
      if (!data.success) {
        throw new StorageError(`${operation} failed: ${JSON.stringify(data.errors ?? [])}`, {
          status: res.status,
        });
      }
      const page = data.result.buckets ?? [];
      for (const b of page) {
        buckets.push({
          name: b.name,
          creationDate: b.creation_date ?? null,
          location: b.location ?? null,
        });
      }
      const next = data.result_info?.cursor;
      cursor = next && next !== cursor && page.length > 0 ? next : undefined;
    } while (cursor);
    return buckets;
  }

  private send(operation: string, url: string | URL, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.apiToken}`);
    return fetchWithRetry(
      operation,
      async () => new Request(url, { ...init, headers }),
      this.retry,
    );
  }
}
