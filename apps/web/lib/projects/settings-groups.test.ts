import { PROJECT_LIMITS } from '@vrt/shared';
import { describe, expect, it } from 'vitest';
import { settingsToForm, validateSettingsGroup } from './settings-groups';

describe('validateSettingsGroup', () => {
  it('returns inline errors per field from projectSettingsSchema', () => {
    const result = validateSettingsGroup('general', {
      name: '',
      slug: 'Not A Slug',
      sitemapIndex: 'ftp://example.com/sitemap.xml',
      notes: '',
    });
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        name: 'This field is required',
        slug: 'Use lowercase letters, digits and single dashes',
        sitemapIndex: 'Expected an http(s) URL',
      },
    });
  });

  it('enforces the min/max of numeric capture settings', () => {
    const { max } = PROJECT_LIMITS.captureConcurrency;
    const result = validateSettingsGroup('capture', {
      captureConcurrency: String(max + 1),
      pageTimeoutMs: '',
      settleMs: '3000',
      maxPageHeight: '16384',
      checkRedirects: true,
      fileExtensions: '',
      hideSelectors: '',
      extraCss: '',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.captureConcurrency).toBe(`Concurrency must be at most ${max}`);
    expect(result.fieldErrors.pageTimeoutMs).toBe('Enter a number');
    expect(Object.keys(result.fieldErrors)).toEqual(['captureConcurrency', 'pageTimeoutMs']);
  });

  it('converts lines, empty strings and numbers', () => {
    const result = validateSettingsGroup('capture', {
      captureConcurrency: '4',
      pageTimeoutMs: '30000',
      settleMs: '0',
      maxPageHeight: '8000',
      checkRedirects: false,
      fileExtensions: '',
      hideSelectors: '#cookie-banner\n\n  .chat  \n',
      extraCss: '  ',
    });
    expect(result).toEqual({
      ok: true,
      data: {
        captureConcurrency: 4,
        pageTimeoutMs: 30000,
        settleMs: 0,
        maxPageHeight: 8000,
        checkRedirects: false,
        fileExtensions: null,
        hideSelectors: ['#cookie-banner', '.chat'],
        extraCss: null,
      },
    });
  });

  it('round-trips stored settings through the form', () => {
    const stored = {
      diffThreshold: 0.1,
      changeThresholdPct: 0.05,
    };
    const form = settingsToForm('diff', stored as never);
    expect(form).toEqual({ diffThreshold: '0.1', changeThresholdPct: '0.05' });
    expect(validateSettingsGroup('diff', form)).toEqual({ ok: true, data: stored });
  });
});
