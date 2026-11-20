import { PROJECT_DEFAULTS } from '@vrt/shared';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { classifyPct, decodePng, diffImages, encodePng, maskRegions, padPng } from './diff';
import { readFixture, readGolden } from './test/helpers';

interface GoldenDiff {
  name: string;
  a: string;
  b: string;
  diffPixels: number;
  totalPixels: number;
  pct: number;
}

const png = (name: string) => readFixture('png', name);

describe('diffImages golden parity', () => {
  const golden = readGolden<GoldenDiff[]>('png-diffs.json');

  it('covers identical, 1-pixel, height-difference and antialias pairs', () => {
    expect(golden.map((g) => g.name)).toEqual(
      expect.arrayContaining(['identical', 'one-pixel', 'height-difference', 'antialias']),
    );
  });

  it.each(golden)('$name: diff counts identical to the prototype', (g) => {
    const res = diffImages(png(g.a), png(g.b));
    expect(res.diffPixels).toBe(g.diffPixels);
    expect(res.totalPixels).toBe(g.totalPixels);
    expect(res.pct).toBe(g.pct);
    expect(res.changed).toBe(g.pct >= PROJECT_DEFAULTS.changeThresholdPct);
  });

  it('reports padded size and original dimensions', () => {
    const res = diffImages(png('height-difference-a.png'), png('height-difference-b.png'));
    expect([res.width, res.height]).toEqual([64, 60]);
    expect(res.beforeDims).toEqual([64, 48]);
    expect(res.afterDims).toEqual([64, 60]);
    expect([res.diffPng.width, res.diffPng.height]).toEqual([64, 60]);
    // Diff pixels are painted in the highlight colour.
    const d = res.diffPng.data;
    const i = (55 * 64 + 3) * 4;
    expect([d[i], d[i + 1], d[i + 2]]).toEqual([255, 0, 128]);
  });

  it('honours threshold and changeThresholdPct options', () => {
    const one = diffImages(png('one-pixel-a.png'), png('one-pixel-b.png'));
    expect(one.changed).toBe(false); // 1 / 3072 = 0.033 % < 0.05 %
    expect(
      diffImages(png('one-pixel-a.png'), png('one-pixel-b.png'), { changeThresholdPct: 0.01 })
        .changed,
    ).toBe(true);
    expect(
      diffImages(png('one-pixel-a.png'), png('one-pixel-b.png'), { threshold: 1 }).diffPixels,
    ).toBe(0);
    expect(PROJECT_DEFAULTS.diffThreshold).toBe(0.1);
  });
});

describe('region masking', () => {
  it('masks a region in both images before diffing', () => {
    const a = png('block-change-a.png');
    const b = png('block-change-b.png');
    expect(diffImages(a, b).diffPixels).toBe(256);
    const masked = diffImages(a, b, { regions: [{ x: 40, y: 20, width: 16, height: 16 }] });
    expect(masked.diffPixels).toBe(0);
    const partial = diffImages(a, b, { regions: [{ x: 40, y: 20, width: 8, height: 16 }] });
    expect(partial.diffPixels).toBeGreaterThan(100);
    expect(partial.diffPixels).toBeLessThanOrEqual(128);
  });

  it('clips regions to the image and fills them with #7f7f7f', () => {
    const img = new PNG({ width: 4, height: 4 });
    img.data.fill(0);
    maskRegions(img, [{ x: -2, y: 2.5, width: 3.2, height: 10 }]);
    const px = (x: number, y: number) => [
      ...img.data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4),
    ];
    expect(px(0, 2)).toEqual([127, 127, 127, 255]);
    expect(px(1, 3)).toEqual([127, 127, 127, 255]);
    expect(px(2, 2)).toEqual([0, 0, 0, 0]);
    expect(px(0, 1)).toEqual([0, 0, 0, 0]);
  });
});

describe('png helpers', () => {
  it('padPng pads with white and returns the same image when already sized', () => {
    const img = decodePng(png('identical-a.png'));
    expect(padPng(img, img.width, img.height)).toBe(img);
    const padded = padPng(img, 70, 50);
    expect([padded.width, padded.height]).toEqual([70, 50]);
    expect([...padded.data.subarray(padded.data.length - 4)]).toEqual([255, 255, 255, 255]);
    expect([...padded.data.subarray(0, 4)]).toEqual([...img.data.subarray(0, 4)]);
  });

  it('encodePng round-trips through decodePng', () => {
    const img = decodePng(png('one-pixel-b.png'));
    const back = decodePng(encodePng(img));
    expect(Buffer.from(back.data).equals(Buffer.from(img.data))).toBe(true);
  });

  it('classifyPct uses >= against the change threshold', () => {
    expect(classifyPct(0.05)).toBe('changed');
    expect(classifyPct(0.049)).toBe('unchanged');
    expect(classifyPct(1, 2)).toBe('unchanged');
  });
});
