import { PROBE_KEY, type ObjectStore } from '@vrt/shared';

/** Bucket lifecycle as used by *Check bucket*; `CloudflareBucketAdmin` implements it. */
export interface BucketExistence {
  exists(name: string): Promise<boolean>;
  ensure(name: string): Promise<{ created: boolean }>;
}

export interface BucketCheckDeps {
  buckets: BucketExistence;
  store: ObjectStore;
  fetch: typeof fetch;
}

export interface BucketCheckResult {
  exists: boolean;
  created: boolean;
  canReadWriteDelete: boolean;
  publicUrl: 'ok' | 'failed' | 'not_configured';
  error?: string;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `<public url>/<key>` with exactly one slash between them. */
export function publicObjectUrl(publicUrl: string, key: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/${key}`;
}

/**
 * F-PROJ-5: checks the bucket exists (creating it when asked), that the S3 credentials can write,
 * read and delete a probe object, and that the probe is served from the public URL.
 */
export async function checkBucket(
  deps: BucketCheckDeps,
  project: { r2Bucket: string; r2PublicUrl: string | null },
  options: { create: boolean },
): Promise<BucketCheckResult> {
  const result: BucketCheckResult = {
    exists: false,
    created: false,
    canReadWriteDelete: false,
    publicUrl: project.r2PublicUrl ? 'failed' : 'not_configured',
  };
  try {
    result.exists = await deps.buckets.exists(project.r2Bucket);
    if (!result.exists && options.create) {
      result.created = (await deps.buckets.ensure(project.r2Bucket)).created;
      result.exists = true;
    }
  } catch (error) {
    return { ...result, error: `Bucket check failed: ${message(error)}` };
  }
  if (!result.exists) return { ...result, error: `Bucket ${project.r2Bucket} does not exist` };

  const probe = `vrt probe ${new Date().toISOString()} ${crypto.randomUUID()}`;
  const bytes = new TextEncoder().encode(probe);
  try {
    await deps.store.put(project.r2Bucket, PROBE_KEY, bytes, 'text/plain');
  } catch (error) {
    return { ...result, error: `Could not write the probe object: ${message(error)}` };
  }
  try {
    const read = new TextDecoder().decode(await deps.store.get(project.r2Bucket, PROBE_KEY));
    if (read !== probe) throw new Error('the probe object came back with different content');
    if (project.r2PublicUrl) {
      try {
        const res = await deps.fetch(publicObjectUrl(project.r2PublicUrl, PROBE_KEY), {
          cache: 'no-store',
        });
        result.publicUrl = res.ok && (await res.text()) === probe ? 'ok' : 'failed';
      } catch {
        result.publicUrl = 'failed';
      }
    }
  } catch (error) {
    await deps.store.delete(project.r2Bucket, [PROBE_KEY]).catch(() => undefined);
    return { ...result, error: `Could not read the probe object: ${message(error)}` };
  }
  try {
    await deps.store.delete(project.r2Bucket, [PROBE_KEY]);
  } catch (error) {
    return { ...result, error: `Could not delete the probe object: ${message(error)}` };
  }
  return { ...result, canReadWriteDelete: true };
}
