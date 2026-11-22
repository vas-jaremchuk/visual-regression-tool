import { describe, expect, it } from 'vitest';
import {
  countsFor,
  imageSrc,
  itemPath,
  keyBelongsToComparison,
  severity,
  statusesFor,
  viewportTabs,
} from './report';

describe('severity', () => {
  it('uses the prototype bands: > 5 high, > 1 mid, else low', () => {
    expect(severity(5.01)).toBe('high');
    expect(severity(5)).toBe('mid');
    expect(severity(1.01)).toBe('mid');
    expect(severity(1)).toBe('low');
    expect(severity(0.06)).toBe('low');
  });
});

describe('statusesFor', () => {
  it('counts compared as changed, unchanged and error', () => {
    expect(statusesFor('compared')).toEqual(['changed', 'unchanged', 'error']);
    expect(statusesFor('redirect')).toEqual(['redirect']);
  });
});

describe('countsFor', () => {
  const counts = {
    compared: 3,
    changed: 2,
    files_total: 4,
    viewports: { mobile: { compared: 1, changed: 1 } },
  };
  it('returns the totals for all viewports and zero for missing counters', () => {
    expect(countsFor(counts, null)).toEqual({
      compared: 3,
      changed: 2,
      unchanged: 0,
      new: 0,
      missing: 0,
      redirect: 0,
      error: 0,
    });
  });
  it('returns one viewport', () => {
    expect(countsFor(counts, 'mobile')).toMatchObject({ compared: 1, changed: 1, new: 0 });
    expect(countsFor(counts, 'tablet').compared).toBe(0);
  });
});

describe('viewportTabs', () => {
  it('prefers the frozen settings, else the counted viewports', () => {
    expect(viewportTabs(['desktop', 'mobile'], {})).toEqual(['desktop', 'mobile']);
    expect(viewportTabs(undefined, { viewports: { mobile: {}, desktop: {} } })).toEqual([
      'desktop',
      'mobile',
    ]);
  });
});

describe('itemPath', () => {
  it('shows the path and query, or the name without a URL', () => {
    expect(itemPath('https://example.com/a/b?x=1', 'n')).toBe('/a/b?x=1');
    expect(itemPath('https://example.com', 'n')).toBe('/');
    expect(itemPath(null, 'legacy.png')).toBe('legacy.png');
  });
});

describe('imageSrc', () => {
  it('uses the public URL when set', () => {
    expect(imageSrc('https://img.example.com/', 'c1', 'diffs/a/b.png')).toBe(
      'https://img.example.com/diffs/a/b.png',
    );
  });
  it('falls back to the signing endpoint', () => {
    expect(imageSrc(null, 'c1', 'diffs/a b/c.png')).toBe(
      '/api/r2/sign?comparison=c1&key=diffs%2Fa+b%2Fc.png&redirect=1',
    );
  });
});

describe('keyBelongsToComparison', () => {
  const scope = {
    label: '2026-11-01_10-00-00_vs_2026-11-02_10-00-00',
    beforeLabel: '2026-11-01_10-00-00',
    afterLabel: '2026-11-02_10-00-00',
  };
  it('accepts objects of the two runs, the diffs and the report', () => {
    expect(keyBelongsToComparison('screenshots/2026-11-01_10-00-00/home.png', scope)).toBe(true);
    expect(keyBelongsToComparison(`diffs/${scope.label}/desktop/home.png`, scope)).toBe(true);
  });
  it('refuses other runs and malformed scopes', () => {
    expect(keyBelongsToComparison('screenshots/2026-11-03_10-00-00/home.png', scope)).toBe(false);
    expect(keyBelongsToComparison('screenshots/x/home.png', { ...scope, beforeLabel: 'x' })).toBe(
      false,
    );
  });
});
