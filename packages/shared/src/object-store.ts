/**
 * Object storage contract (05 §10). Implemented by `@vrt/storage` over the R2 S3 API and by
 * `FakeObjectStore` in `@vrt/storage/testing`; engine code receives it as a parameter.
 */

export interface ObjectEntry {
  key: string;
  size: number;
}

export interface ObjectHead {
  size: number;
  contentType: string | null;
  etag: string | null;
}

export interface ListOptions {
  /** Group keys sharing the prefix up to this delimiter; only direct children are yielded. */
  delimiter?: string;
  /** Keys requested per page (S3 `max-keys`, at most 1000). */
  pageSize?: number;
}

export interface ObjectStore {
  put(bucket: string, key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Throws `ObjectNotFoundError` from `@vrt/storage` when the key does not exist. */
  get(bucket: string, key: string): Promise<Uint8Array>;
  /** Returns `null` when the key does not exist. */
  head(bucket: string, key: string): Promise<ObjectHead | null>;
  list(bucket: string, prefix: string, opts?: ListOptions): AsyncIterable<ObjectEntry>;
  /** Common prefixes directly under `prefix`, e.g. `screenshots/<ts>/`. */
  listPrefixes(bucket: string, prefix: string, delimiter?: string): AsyncIterable<string>;
  /** Deletes all keys; missing keys are not an error. */
  delete(bucket: string, keys: string[]): Promise<void>;
  /** Presigned GET URL valid for `expiresInSeconds` (default `SIGNED_URL_TTL_MS`). */
  presignGet(bucket: string, key: string, expiresInSeconds?: number): Promise<string>;
}
