import { describe, expect, it } from 'vitest';
import { buildLegacyRunItems, legacyPageUrls } from './legacy';

const LABEL = '2026-08-07_10-00-00';
const key = (name: string) => `screenshots/${LABEL}/${name}`;

describe('legacyPageUrls', () => {
  it('maps filenames to snapshot page URLs as a new run names them', () => {
    const map = legacyPageUrls([
      { url: 'https://example.com/a-b', kind: 'page', included: true },
      { url: 'https://example.com/a_b', kind: 'page', included: true },
      { url: 'https://example.com/old/', kind: 'page', included: false },
      { url: 'https://example.com/doc.pdf', kind: 'file', included: true },
    ]);
    expect(Object.fromEntries(map)).toEqual({
      'a-b.png': 'https://example.com/a-b',
      'a_b.png': 'https://example.com/a_b',
      'old_.png': 'https://example.com/old/',
    });
  });

  it('gives a colliding URL the __2 name, and excluded URLs never displace included ones', () => {
    const map = legacyPageUrls([
      { url: 'https://example.com/a?b', kind: 'page', included: true },
      { url: 'https://example.com/a/b', kind: 'page', included: true },
      { url: 'https://example.com/a&b', kind: 'page', included: false },
    ]);
    expect(map.get('a_b.png')).toBe('https://example.com/a/b');
    expect(map.get('a_b__2.png')).toBe('https://example.com/a?b');
  });
});

describe('buildLegacyRunItems', () => {
  const base = { label: LABEL, fingerprints: new Map<string, string>(), pageUrls: new Map() };

  it('skips legacy screenshots of file links and keys outside the run', () => {
    const plan = buildLegacyRunItems({
      ...base,
      objects: [
        { key: key('index.png'), size: 10 },
        { key: key('doc.pdf.png'), size: 10 },
        { key: key('desktop/index.png'), size: 10 },
        { key: 'screenshots/2026-08-08_00-00-00/index.png', size: 10 },
      ],
    });
    expect(plan.items.map((i) => i.filename)).toEqual(['index.png']);
    expect(plan.items[0]).toMatchObject({ url: null, viewport_slug: 'desktop', bytes: 10 });
    expect(plan.skipped).toHaveLength(3);
  });

  it('honours the project file extensions', () => {
    const plan = buildLegacyRunItems({
      ...base,
      objects: [{ key: key('doc.pdf.png'), size: 1 }],
      fileExtensions: ['zip'],
    });
    expect(plan.items.map((i) => i.filename)).toEqual(['doc.pdf.png']);
  });

  it('parses the fingerprint, including final-url and error hashes', () => {
    const plan = buildLegacyRunItems({
      ...base,
      objects: [{ key: key('f.docx.txt'), size: 99 }],
      fingerprints: new Map([
        [
          key('f.docx.txt'),
          'url: https://example.com/f.docx\nfinal-url: https://cdn.example.com/f.docx\n' +
            'sha256: ERROR timeout\nsize: 0\nstatus: 0\ncontent-type: \nlast-modified: \netag: \n',
        ],
      ]),
    });
    expect(plan.items[0]).toMatchObject({
      url: 'https://example.com/f.docx',
      kind: 'file',
      viewport_slug: null,
      filename: 'f.docx.png',
      r2_key: key('f.docx.txt'),
      sha256: 'ERROR timeout',
      bytes: 0,
      http_status: null,
      content_type: null,
      final_url: 'https://cdn.example.com/f.docx',
    });
  });

  it('keeps URLs unique per viewport', () => {
    const plan = buildLegacyRunItems({
      ...base,
      objects: [
        { key: key('a.png'), size: 1 },
        { key: key('b.png'), size: 1 },
      ],
      pageUrls: new Map([
        ['a.png', 'https://example.com/x'],
        ['b.png', 'https://example.com/x'],
      ]),
    });
    expect(plan.items.map((i) => i.url)).toEqual(['https://example.com/x', null]);
  });
});
