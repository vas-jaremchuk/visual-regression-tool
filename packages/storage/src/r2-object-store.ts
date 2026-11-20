import { AwsClient } from 'aws4fetch';
import {
  SIGNED_URL_TTL_MS,
  type ListOptions,
  type ObjectEntry,
  type ObjectHead,
  type ObjectStore,
} from '@vrt/shared';
import { ObjectNotFoundError, StorageError } from './errors';
import { fetchWithRetry, type RetryOptions } from './retry';
import { escapeXml, parseDeleteErrors, parseListObjectsV2, type ListPage } from './xml';

/** S3 DeleteObjects accepts at most this many keys per request. */
export const DELETE_BATCH_SIZE = 1000;
/** S3 ListObjectsV2 returns at most this many keys per page. */
export const MAX_LIST_PAGE_SIZE = 1000;
/** SigV4 presigned URLs are valid for at most 7 days. */
export const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;

export interface R2ObjectStoreOptions extends RetryOptions {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Defaults to `https://<accountId>.r2.cloudflarestorage.com` (ADR-3). */
  endpoint?: string;
}

/** Encodes each path segment of a key; `/` stays a separator. */
function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

/** `ObjectStore` over the R2 S3-compatible API, signed with aws4fetch (ADR-3, NFR-9). */
export class R2ObjectStore implements ObjectStore {
  readonly endpoint: string;
  private readonly client: AwsClient;
  private readonly retry: RetryOptions;

  constructor(options: R2ObjectStoreOptions) {
    const { accountId, accessKeyId, secretAccessKey, endpoint, ...retry } = options;
    this.endpoint = (endpoint ?? `https://${accountId}.r2.cloudflarestorage.com`).replace(
      /\/+$/,
      '',
    );
    // Retries are ours (NFR-9), so aws4fetch's own retry loop is disabled.
    this.client = new AwsClient({
      accessKeyId,
      secretAccessKey,
      service: 's3',
      region: 'auto',
      retries: 0,
    });
    this.retry = retry;
  }

  async put(bucket: string, key: string, body: Uint8Array, contentType: string): Promise<void> {
    const res = await this.send(`R2 put ${bucket}/${key}`, this.objectUrl(bucket, key), {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: body as Uint8Array<ArrayBuffer>,
    });
    if (!res.ok) throw await StorageError.fromResponse(`R2 put ${bucket}/${key}`, res);
    await res.body?.cancel();
  }

  async get(bucket: string, key: string): Promise<Uint8Array> {
    const res = await this.send(`R2 get ${bucket}/${key}`, this.objectUrl(bucket, key), {
      method: 'GET',
    });
    if (res.status === 404) {
      await res.body?.cancel();
      throw new ObjectNotFoundError(bucket, key);
    }
    if (!res.ok) throw await StorageError.fromResponse(`R2 get ${bucket}/${key}`, res);
    return new Uint8Array(await res.arrayBuffer());
  }

  async head(bucket: string, key: string): Promise<ObjectHead | null> {
    const res = await this.send(`R2 head ${bucket}/${key}`, this.objectUrl(bucket, key), {
      method: 'HEAD',
    });
    await res.body?.cancel();
    if (res.status === 404) return null;
    if (!res.ok)
      throw new StorageError(`R2 head ${bucket}/${key} failed: ${res.status}`, {
        status: res.status,
      });
    return {
      size: Number(res.headers.get('content-length') ?? 0),
      contentType: res.headers.get('content-type'),
      etag: res.headers.get('etag'),
    };
  }

  async *list(bucket: string, prefix: string, opts: ListOptions = {}): AsyncIterable<ObjectEntry> {
    for await (const page of this.pages(bucket, prefix, opts)) yield* page.objects;
  }

  async *listPrefixes(bucket: string, prefix: string, delimiter = '/'): AsyncIterable<string> {
    for await (const page of this.pages(bucket, prefix, { delimiter })) yield* page.prefixes;
  }

  async delete(bucket: string, keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
      await this.deleteBatch(bucket, keys.slice(i, i + DELETE_BATCH_SIZE));
    }
  }

  async presignGet(
    bucket: string,
    key: string,
    expiresInSeconds = SIGNED_URL_TTL_MS / 1000,
  ): Promise<string> {
    if (
      !Number.isInteger(expiresInSeconds) ||
      expiresInSeconds < 1 ||
      expiresInSeconds > MAX_PRESIGN_SECONDS
    ) {
      throw new RangeError(`expiresInSeconds must be an integer in 1..${MAX_PRESIGN_SECONDS}`);
    }
    const url = new URL(this.objectUrl(bucket, key));
    url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));
    const signed = await this.client.sign(url, { method: 'GET', aws: { signQuery: true } });
    return signed.url;
  }

  private objectUrl(bucket: string, key: string): string {
    return `${this.endpoint}/${encodeURIComponent(bucket)}/${encodeKey(key)}`;
  }

  private send(operation: string, url: string | URL, init: RequestInit): Promise<Response> {
    return fetchWithRetry(operation, () => this.client.sign(url, init), this.retry);
  }

  private async *pages(bucket: string, prefix: string, opts: ListOptions): AsyncIterable<ListPage> {
    const operation = `R2 list ${bucket}/${prefix}`;
    const pageSize = Math.min(opts.pageSize ?? MAX_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE);
    let token: string | undefined;
    do {
      const url = new URL(`${this.endpoint}/${encodeURIComponent(bucket)}`);
      url.searchParams.set('list-type', '2');
      url.searchParams.set('max-keys', String(pageSize));
      if (prefix) url.searchParams.set('prefix', prefix);
      if (opts.delimiter) url.searchParams.set('delimiter', opts.delimiter);
      if (token) url.searchParams.set('continuation-token', token);

      const res = await this.send(operation, url, { method: 'GET' });
      if (!res.ok) throw await StorageError.fromResponse(operation, res);
      const page = parseListObjectsV2(await res.text());
      yield page;

      if (page.isTruncated && !page.nextContinuationToken) {
        throw new StorageError(`${operation} failed: truncated page without continuation token`);
      }
      token = page.isTruncated ? page.nextContinuationToken : undefined;
    } while (token);
  }

  private async deleteBatch(bucket: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const operation = `R2 delete ${keys.length} keys from ${bucket}`;
    const objects = keys.map((key) => `<Object><Key>${escapeXml(key)}</Key></Object>`).join('');
    const body = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${objects}</Delete>`;
    const res = await this.send(
      operation,
      `${this.endpoint}/${encodeURIComponent(bucket)}?delete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body,
      },
    );
    if (!res.ok) throw await StorageError.fromResponse(operation, res);
    const errors = parseDeleteErrors(await res.text()).filter((e) => e.code !== 'NoSuchKey');
    if (errors.length > 0) {
      const sample = errors
        .slice(0, 5)
        .map((e) => `${e.key}: ${e.code}`)
        .join(', ');
      throw new StorageError(`${operation} failed for ${errors.length} keys (${sample})`, {
        status: res.status,
      });
    }
  }
}
