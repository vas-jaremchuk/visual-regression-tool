import { createHash } from 'node:crypto';
import { diffImages, encodePng } from '@vrt/engine/diff';
import { DIFF_MAX_PIXELS, diffRequest, type DiffResponse, type ObjectStore } from '@vrt/shared';
import { ObjectNotFoundError } from '@vrt/storage';

/** A failure with an HTTP status and an `apiErrorResponse` code (09). */
export class DiffError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'DiffError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height from the PNG IHDR chunk, read without decoding the image. */
export function pngDimensions(buffer: Uint8Array): [number, number] | null {
  if (buffer.byteLength < 24) return null;
  if (PNG_SIGNATURE.some((byte, i) => buffer[i] !== byte)) return null;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (String.fromCharCode(...buffer.subarray(12, 16)) !== 'IHDR') return null;
  return [view.getUint32(16), view.getUint32(20)];
}

async function readPng(store: ObjectStore, bucket: string, key: string, label: string) {
  let bytes: Uint8Array;
  try {
    bytes = await store.get(bucket, key);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      throw new DiffError(404, 'not_found', `${label} image not found: ${bucket}/${key}`);
    }
    throw error;
  }
  const dims = pngDimensions(bytes);
  if (!dims) {
    throw new DiffError(422, 'business_rule', `${label} image is not a PNG: ${bucket}/${key}`);
  }
  return { bytes, dims };
}

/**
 * `POST /diff` (06 §6, 09 §4): reads both PNGs from R2, masks regions, diffs, uploads the diff
 * PNG when the pair is changed, and returns the metrics and the after image's sha256.
 */
export async function runDiff(store: ObjectStore, body: unknown): Promise<DiffResponse> {
  const parsed = diffRequest.safeParse(body);
  if (!parsed.success) {
    throw new DiffError(400, 'validation_error', 'Invalid diff request', parsed.error.issues);
  }
  const req = parsed.data;

  const [before, after] = await Promise.all([
    readPng(store, req.bucket, req.beforeKey, 'before'),
    readPng(store, req.bucket, req.afterKey, 'after'),
  ]);

  // Guard before decoding: full-page RGBA buffers are what exhaust the container's memory.
  for (const [label, [width, height]] of [
    ['before', before.dims],
    ['after', after.dims],
  ] as const) {
    if (height > req.maxPageHeight) {
      throw new DiffError(
        422,
        'business_rule',
        `${label} image is ${width}×${height} px, taller than max_page_height ${req.maxPageHeight}`,
        { reason: 'image_too_large', image: label, width, height },
      );
    }
  }
  const width = Math.max(before.dims[0], after.dims[0]);
  const height = Math.max(before.dims[1], after.dims[1]);
  if (width * height > DIFF_MAX_PIXELS) {
    throw new DiffError(
      422,
      'business_rule',
      `Diff area ${width}×${height} px exceeds the ${DIFF_MAX_PIXELS / 1_000_000} MP limit`,
      { reason: 'image_too_large', width, height },
    );
  }

  const result = diffImages(before.bytes, after.bytes, {
    threshold: req.threshold,
    changeThresholdPct: req.changeThresholdPct,
    regions: req.regions,
  });
  if (result.changed) {
    await store.put(req.bucket, req.diffKey, encodePng(result.diffPng), 'image/png');
  }

  return {
    changed: result.changed,
    diffPct: result.pct,
    diffPixels: result.diffPixels,
    totalPixels: result.totalPixels,
    beforeDims: result.beforeDims,
    afterDims: result.afterDims,
    afterSha256: createHash('sha256').update(after.bytes).digest('hex'),
  };
}
