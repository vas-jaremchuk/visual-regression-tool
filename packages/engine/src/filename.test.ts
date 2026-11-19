import { describe, expect, it } from 'vitest';
import { assignFilenames, urlToFilename, urlToName } from './filename';
import { readGolden } from './test/helpers';

interface GoldenFilename {
  url: string;
  filename: string;
}

describe('urlToFilename', () => {
  const golden = readGolden<GoldenFilename[]>('filenames.json');

  it('has at least 200 golden URLs', () => {
    expect(golden.length).toBeGreaterThanOrEqual(200);
  });

  it('matches the prototype for 100 % of the golden URLs', () => {
    const mismatches = golden.filter((g) => urlToFilename(g.url) !== g.filename);
    expect(mismatches).toEqual([]);
  });

  it('follows the documented example', () => {
    expect(urlToFilename('https://stagen.com/about/people/')).toBe('about_people_.png');
    expect(urlToFilename('https://example.com')).toBe('index.png');
    expect(urlToName('https://example.com/a?b=c')).toBe('a_b_c');
  });

  it('caps the name at 200 characters before the extension', () => {
    expect(urlToFilename('https://example.com/' + 'a'.repeat(300))).toBe('a'.repeat(200) + '.png');
  });

  it('throws on an invalid URL, like the prototype', () => {
    expect(() => urlToFilename('not a url')).toThrow();
  });
});

describe('assignFilenames', () => {
  it('suffixes colliding names with __2, __3 in input order', () => {
    expect(
      assignFilenames([
        'https://example.com/foo/bar',
        'https://example.com/foo_bar',
        'https://example.com/other',
        'https://example.com/foo?bar',
      ]),
    ).toEqual([
      { url: 'https://example.com/foo/bar', filename: 'foo_bar.png' },
      {
        url: 'https://example.com/foo_bar',
        filename: 'foo_bar__2.png',
        collidesWith: 'https://example.com/foo/bar',
      },
      { url: 'https://example.com/other', filename: 'other.png' },
      {
        url: 'https://example.com/foo?bar',
        filename: 'foo_bar__3.png',
        collidesWith: 'https://example.com/foo/bar',
      },
    ]);
  });

  it('never hands out a suffixed name that another URL already owns', () => {
    const names = assignFilenames([
      'https://example.com/a__2',
      'https://example.com/a',
      'https://example.com/a/',
    ]).map((a) => a.filename);
    expect(names).toEqual(['a_2.png', 'a.png', 'a_.png']);

    const collide = assignFilenames([
      'https://example.com/x/y',
      'https://example.com/x?y',
      'https://example.com/x_y',
    ]).map((a) => a.filename);
    expect(new Set(collide).size).toBe(3);
    expect(collide).toEqual(['x_y.png', 'x_y__2.png', 'x_y__3.png']);
  });

  it('keeps unique filenames for every golden URL', () => {
    const golden = readGolden<GoldenFilename[]>('filenames.json');
    const assigned = assignFilenames(golden.map((g) => g.url));
    expect(new Set(assigned.map((a) => a.filename)).size).toBe(golden.length);
    for (const [i, a] of assigned.entries()) {
      if (!a.collidesWith) expect(a.filename).toBe(golden[i]!.filename);
    }
  });
});
