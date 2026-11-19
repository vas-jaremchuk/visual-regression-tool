import { describe, expect, it } from 'vitest';
import {
  comparisonLabel,
  diffKey,
  diffPrefix,
  fingerprintKey,
  legacyFingerprintKey,
  legacyRunLabels,
  legacyScreenshotKey,
  parseLegacyKey,
  reportKey,
  runItemKey,
  runLabelsFromPrefixes,
  runPrefix,
  screenshotKey,
} from './r2-keys';

const before = '2026-08-07_10-00-00';
const after = '2026-08-08_11-30-15';
const cmp = `${before}_vs_${after}`;

describe('r2 key builders (new layout)', () => {
  it('builds screenshot keys per viewport', () => {
    expect(screenshotKey(after, 'desktop', 'about_people_.png')).toBe(
      'screenshots/2026-08-08_11-30-15/desktop/about_people_.png',
    );
    expect(screenshotKey(after, 'mobile', 'index')).toBe(
      'screenshots/2026-08-08_11-30-15/mobile/index.png',
    );
    expect(screenshotKey(`${after}-2`, 'tablet-wide', 'index.png')).toBe(
      'screenshots/2026-08-08_11-30-15-2/tablet-wide/index.png',
    );
  });

  it('builds fingerprint keys under _files with the prototype .txt name', () => {
    expect(fingerprintKey(after, 'docs_report.pdf.png')).toBe(
      'screenshots/2026-08-08_11-30-15/_files/docs_report.pdf.txt',
    );
  });

  it('builds diff and report keys', () => {
    expect(comparisonLabel(before, after)).toBe(cmp);
    expect(diffKey(cmp, 'mobile', 'about_people_.png')).toBe(
      `diffs/${cmp}/mobile/about_people_.png`,
    );
    expect(diffPrefix(cmp)).toBe(`diffs/${cmp}/`);
    expect(reportKey(cmp)).toBe(`reports/${cmp}/index.html`);
    expect(runPrefix(before)).toBe(`screenshots/${before}/`);
  });

  it('rejects inputs that would produce ambiguous or escaping keys', () => {
    expect(() => screenshotKey('latest', 'desktop', 'index.png')).toThrow(/run label/);
    expect(() => screenshotKey(after, 'Desktop', 'index.png')).toThrow(/viewport/);
    expect(() => screenshotKey(after, '_files', 'index.png')).toThrow(/viewport/);
    expect(() => screenshotKey(after, 'desktop', '../x.png')).toThrow(/filename/);
    expect(() => screenshotKey(after, 'desktop', '.png')).toThrow(/filename/);
    expect(() => diffKey('nope', 'desktop', 'index.png')).toThrow(/comparison label/);
    expect(() => reportKey(`${before}_vs_`)).toThrow(/comparison label/);
  });

  it('builds run item keys for both layouts', () => {
    const base = { runLabel: after, filename: 'index.png' };
    expect(runItemKey({ ...base, isLegacy: false, kind: 'page', viewportSlug: 'mobile' })).toBe(
      `screenshots/${after}/mobile/index.png`,
    );
    expect(runItemKey({ ...base, isLegacy: false, kind: 'file', viewportSlug: null })).toBe(
      `screenshots/${after}/_files/index.txt`,
    );
    expect(runItemKey({ ...base, isLegacy: true, kind: 'page', viewportSlug: 'desktop' })).toBe(
      `screenshots/${after}/index.png`,
    );
    expect(runItemKey({ ...base, isLegacy: true, kind: 'file', viewportSlug: null })).toBe(
      `screenshots/${after}/index.txt`,
    );
    expect(() =>
      runItemKey({ ...base, isLegacy: false, kind: 'page', viewportSlug: null }),
    ).toThrow(/viewport slug/);
  });
});

describe('r2 key builders and parsers (legacy layout)', () => {
  it('builds legacy keys like the prototype', () => {
    expect(legacyScreenshotKey(before, 'about_people_.png')).toBe(
      'screenshots/2026-08-07_10-00-00/about_people_.png',
    );
    expect(legacyFingerprintKey(before, 'brochure.pdf.png')).toBe(
      'screenshots/2026-08-07_10-00-00/brochure.pdf.txt',
    );
  });

  it('parses legacy keys and maps them to the desktop viewport', () => {
    expect(parseLegacyKey(`screenshots/${before}/about_people_.png`)).toEqual({
      runLabel: before,
      filename: 'about_people_.png',
      kind: 'page',
      viewportSlug: 'desktop',
    });
    expect(parseLegacyKey(`screenshots/${before}/brochure.pdf.txt`)).toEqual({
      runLabel: before,
      filename: 'brochure.pdf.png',
      kind: 'file',
      viewportSlug: null,
    });
  });

  it('builder and parser round-trip', () => {
    const key = legacyScreenshotKey(before, 'a_b.png');
    expect(parseLegacyKey(key)?.filename).toBe('a_b.png');
  });

  it('ignores keys that are not legacy run objects', () => {
    for (const key of [
      `screenshots/${after}/desktop/index.png`,
      `screenshots/${after}/_files/doc.pdf.txt`,
      `screenshots/${before}/notes.json`,
      'screenshots/not-a-run/index.png',
      `diffs/${cmp}/index.png`,
      `reports/${cmp}/index.html`,
    ]) {
      expect(parseLegacyKey(key)).toBeNull();
    }
  });

  it('lists legacy run labels from an object listing', () => {
    const keys = [
      `screenshots/${after}/index.png`,
      `screenshots/${before}/index.png`,
      `screenshots/${before}/doc.pdf.txt`,
      'screenshots/2026-09-01_00-00-00/desktop/index.png',
      'screenshots/2026-09-01_00-00-00/_files/doc.pdf.txt',
      `reports/${cmp}/index.html`,
      `diffs/${cmp}/x.png`,
    ];
    expect(legacyRunLabels(keys)).toEqual([before, after]);
  });

  it('extracts run labels from prefix listings', () => {
    expect(
      runLabelsFromPrefixes([
        `screenshots/${after}/`,
        `screenshots/${before}/`,
        'screenshots/tmp/',
      ]),
    ).toEqual([before, after]);
  });
});
