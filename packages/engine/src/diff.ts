/**
 * Pixel diff (specification/05-engine.md §8, REQ-ENG-8). Port of the prototype `diffImages`.
 * Exported from `@vrt/engine/diff` only, so runtimes that never diff do not bundle pngjs.
 */
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { Region } from './types';

export const DIFF_THRESHOLD = 0.1;
export const CHANGE_THRESHOLD_PCT = 0.05;
export const HIGHLIGHT_COLOR: readonly [number, number, number] = [255, 0, 128];
/** Fill colour of masked `region` ignore rules (#7f7f7f). */
export const REGION_MASK_COLOR: readonly [number, number, number] = [0x7f, 0x7f, 0x7f];

export interface DiffOptions {
  /** Per-pixel colour tolerance 0–1 (project `diff_threshold`). */
  threshold?: number;
  /** Minimum % of changed pixels to flag a page (project `change_threshold_pct`). */
  changeThresholdPct?: number;
  /** Rectangles masked in both images before diffing. */
  regions?: readonly Region[];
}

export interface DiffResult {
  diffPng: PNG;
  diffPixels: number;
  totalPixels: number;
  pct: number;
  changed: boolean;
  width: number;
  height: number;
  beforeDims: [number, number];
  afterDims: [number, number];
}

export function decodePng(buffer: Uint8Array): PNG {
  return PNG.sync.read(Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength));
}

export function encodePng(png: PNG): Uint8Array {
  return new Uint8Array(PNG.sync.write(png));
}

/** Pads an image to width × height with white (255 in every channel), top-left aligned. */
export function padPng(png: PNG, width: number, height: number): PNG {
  if (png.width === width && png.height === height) return png;
  const out = new PNG({ width, height });
  out.data.fill(255);
  PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, 0);
  return out;
}

/** Fills each region (clipped to the image) with `REGION_MASK_COLOR`, in place. */
export function maskRegions(png: PNG, regions: readonly Region[]): void {
  const [r, g, b] = REGION_MASK_COLOR;
  for (const region of regions) {
    const x0 = Math.max(0, Math.floor(region.x));
    const y0 = Math.max(0, Math.floor(region.y));
    const x1 = Math.min(png.width, Math.ceil(region.x + region.width));
    const y1 = Math.min(png.height, Math.ceil(region.y + region.height));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * png.width + x) * 4;
        png.data[i] = r;
        png.data[i + 1] = g;
        png.data[i + 2] = b;
        png.data[i + 3] = 255;
      }
    }
  }
}

export type DiffClass = 'changed' | 'unchanged';

/** `changed` when `pct >= changeThresholdPct`. */
export function classifyPct(pct: number, changeThresholdPct = CHANGE_THRESHOLD_PCT): DiffClass {
  return pct >= changeThresholdPct ? 'changed' : 'unchanged';
}

/** Decodes, pads, masks and pixel-diffs two PNGs. */
export function diffImages(bufA: Uint8Array, bufB: Uint8Array, opts: DiffOptions = {}): DiffResult {
  const pngA = decodePng(bufA);
  const pngB = decodePng(bufB);
  const width = Math.max(pngA.width, pngB.width);
  const height = Math.max(pngA.height, pngB.height);
  const a = padPng(pngA, width, height);
  const b = padPng(pngB, width, height);
  // a and b are freshly decoded here, so masking in place is safe.
  maskRegions(a, opts.regions ?? []);
  maskRegions(b, opts.regions ?? []);
  const diffPng = new PNG({ width, height });
  const diffPixels = pixelmatch(a.data, b.data, diffPng.data, width, height, {
    threshold: opts.threshold ?? DIFF_THRESHOLD,
    includeAA: false,
    diffColor: [...HIGHLIGHT_COLOR],
  });
  const totalPixels = width * height;
  const pct = (diffPixels / totalPixels) * 100;
  return {
    diffPng,
    diffPixels,
    totalPixels,
    pct,
    changed: classifyPct(pct, opts.changeThresholdPct) === 'changed',
    width,
    height,
    beforeDims: [pngA.width, pngA.height],
    afterDims: [pngB.width, pngB.height],
  };
}
