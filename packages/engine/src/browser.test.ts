import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { pngSize } from './browser';
import { readFixture } from './test/helpers';

describe('pngSize', () => {
  it('reads width and height from the IHDR chunk', () => {
    const png = readFixture('png', 'height-difference-b.png');
    const decoded = PNG.sync.read(png);
    expect(pngSize(png)).toEqual({ width: decoded.width, height: decoded.height });
  });

  it('rejects bytes that are not a PNG', () => {
    expect(() => pngSize(new TextEncoder().encode('not a png at all, really not'))).toThrow(
      'Not a PNG image',
    );
  });
});
