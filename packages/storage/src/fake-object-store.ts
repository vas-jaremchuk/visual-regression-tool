import {
  SIGNED_URL_TTL_MS,
  type ListOptions,
  type ObjectEntry,
  type ObjectHead,
  type ObjectStore,
} from '@vrt/shared';
import { ObjectNotFoundError } from './errors';

interface StoredObject {
  body: Uint8Array;
  contentType: string;
}

/** In-memory `ObjectStore` for tests; keys are listed in lexicographic order like S3. */
export class FakeObjectStore implements ObjectStore {
  readonly buckets = new Map<string, Map<string, StoredObject>>();

  async put(bucket: string, key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.bucket(bucket).set(key, { body: body.slice(), contentType });
  }

  async get(bucket: string, key: string): Promise<Uint8Array> {
    const object = this.buckets.get(bucket)?.get(key);
    if (!object) throw new ObjectNotFoundError(bucket, key);
    return object.body.slice();
  }

  async head(bucket: string, key: string): Promise<ObjectHead | null> {
    const object = this.buckets.get(bucket)?.get(key);
    if (!object) return null;
    return { size: object.body.byteLength, contentType: object.contentType, etag: null };
  }

  async *list(bucket: string, prefix: string, opts: ListOptions = {}): AsyncIterable<ObjectEntry> {
    for (const key of this.sortedKeys(bucket, prefix)) {
      if (opts.delimiter && key.slice(prefix.length).includes(opts.delimiter)) continue;
      yield { key, size: this.buckets.get(bucket)!.get(key)!.body.byteLength };
    }
  }

  async *listPrefixes(bucket: string, prefix: string, delimiter = '/'): AsyncIterable<string> {
    const seen = new Set<string>();
    for (const key of this.sortedKeys(bucket, prefix)) {
      const at = key.indexOf(delimiter, prefix.length);
      if (at === -1) continue;
      const common = key.slice(0, at + delimiter.length);
      if (!seen.has(common)) {
        seen.add(common);
        yield common;
      }
    }
  }

  async delete(bucket: string, keys: string[]): Promise<void> {
    const objects = this.buckets.get(bucket);
    for (const key of keys) objects?.delete(key);
  }

  async presignGet(
    bucket: string,
    key: string,
    expiresInSeconds = SIGNED_URL_TTL_MS / 1000,
  ): Promise<string> {
    return `https://fake-r2.test/${bucket}/${key}?X-Amz-Expires=${expiresInSeconds}`;
  }

  private bucket(name: string): Map<string, StoredObject> {
    let objects = this.buckets.get(name);
    if (!objects) {
      objects = new Map();
      this.buckets.set(name, objects);
    }
    return objects;
  }

  private sortedKeys(bucket: string, prefix: string): string[] {
    const keys = [...(this.buckets.get(bucket)?.keys() ?? [])].filter((k) => k.startsWith(prefix));
    return keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
}
