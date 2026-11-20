import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILE_EXTENSIONS, extOf, isFileScreenshotName, isFileUrl } from './files';
import { FIXTURES, readGolden } from './test/helpers';

interface GoldenFilename {
  url: string;
  filename: string;
  isFileUrl: boolean;
  isFileScreenshotName: boolean;
}

describe('file classification', () => {
  const golden = readGolden<GoldenFilename[]>('filenames.json');

  it('FILE_EXTENSIONS is identical to the prototype list', () => {
    const src = fs.readFileSync(path.join(FIXTURES, '../prototype/files.js'), 'utf8');
    const list = src.match(/const FILE_EXTENSIONS = new Set\(\[([\s\S]*?)\]\)/)![1]!;
    const proto = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...FILE_EXTENSIONS]).toEqual(proto);
  });

  it('isFileUrl matches the prototype on the golden URLs', () => {
    expect(golden.filter((g) => isFileUrl(g.url) !== g.isFileUrl)).toEqual([]);
    expect(golden.some((g) => g.isFileUrl)).toBe(true);
  });

  it('isFileScreenshotName matches the prototype on the golden filenames', () => {
    expect(
      golden.filter((g) => isFileScreenshotName(g.filename) !== g.isFileScreenshotName),
    ).toEqual([]);
    expect(isFileScreenshotName('2026_Newsletter.pdf.png')).toBe(true);
    expect(isFileScreenshotName('about_people_.png')).toBe(false);
  });

  it('extOf ignores the query string and handles invalid URLs', () => {
    expect(extOf('https://example.com/a/Report.PDF?v=2')).toBe('pdf');
    expect(extOf('https://example.com/a/')).toBe('');
    expect(extOf('nope')).toBe('');
  });

  it('accepts a project file_extensions override', () => {
    expect(isFileUrl('https://example.com/page.html', ['HTML'])).toBe(true);
    expect(isFileUrl('https://example.com/report.pdf', ['.html'])).toBe(false);
    expect(isFileUrl('https://example.com/report.pdf', null)).toBe(true);
    expect(isFileScreenshotName('page.html.png', new Set(['html']))).toBe(true);
    expect(isFileScreenshotName('report.pdf.png', [])).toBe(false);
  });
});
