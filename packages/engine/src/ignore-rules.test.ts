import { describe, expect, it } from 'vitest';
import {
  isUrlIgnored,
  matchesUrlPattern,
  matchingUrlRules,
  regionsFor,
  selectorsFor,
} from './ignore-rules';
import type { IgnoreRule } from './types';

describe('matchesUrlPattern', () => {
  it('matches globs against the full URL', () => {
    expect(matchesUrlPattern('https://example.com/blog/*', 'https://example.com/blog/post')).toBe(
      true,
    );
    expect(matchesUrlPattern('https://example.com/blog/*', 'https://example.com/blog/a/b')).toBe(
      false,
    );
    expect(matchesUrlPattern('https://example.com/blog/**', 'https://example.com/blog/a/b')).toBe(
      true,
    );
    expect(matchesUrlPattern('**/*.pdf', 'https://example.com/x/y/r.pdf')).toBe(true);
    expect(matchesUrlPattern('**/*.pdf', 'https://example.com/x/y/r.pdf?v=1')).toBe(false);
    expect(matchesUrlPattern('https://example.com/a', 'https://example.com/a/')).toBe(false);
  });

  it('treats regex metacharacters in globs literally', () => {
    const url = 'https://example.com/search?q=a+b&x=(1)';
    expect(matchesUrlPattern(url, url)).toBe(true);
    expect(matchesUrlPattern('https://example.com/search?q=a+b*', url)).toBe(true);
    expect(matchesUrlPattern('https://example.com/search.q=a+b*', url)).toBe(false);
  });

  it('supports re: regular expressions and rejects invalid ones', () => {
    expect(matchesUrlPattern('re:/news/\\d{4}/', 'https://example.com/news/2026/x')).toBe(true);
    expect(matchesUrlPattern('re:^https://example\\.org', 'https://example.com/')).toBe(false);
    expect(matchesUrlPattern('re:(', 'https://example.com/')).toBe(false);
    expect(matchesUrlPattern('re:(', 'https://example.com/')).toBe(false); // cached
  });
});

const rules: IgnoreRule[] = [
  { type: 'url_pattern', url_pattern: 'https://example.com/private/**', applies_to: 'both' },
  { type: 'url_pattern', url_pattern: 'https://example.com/live/*', applies_to: 'compare' },
  { type: 'url_pattern', url_pattern: 'https://example.com/slow/*', applies_to: 'capture' },
  { type: 'url_pattern', url_pattern: 'https://example.com/off/*', enabled: false },
  { type: 'url_pattern', url_pattern: 'https://example.com/m/*', viewport_slug: 'mobile' },
  { type: 'url_pattern', url_pattern: null },
  { type: 'selector', selector: '.chat-widget' },
  { type: 'selector', selector: '.ad', url_pattern: 'https://example.com/news/**' },
  { type: 'selector', selector: '.carousel', viewport_slug: 'mobile' },
  { type: 'selector', selector: '.disabled', enabled: false },
  { type: 'selector', selector: null },
  { type: 'region', region: { x: 0, y: 0, width: 10, height: 10 } },
  { type: 'region', region: { x: 5, y: 5, width: 1, height: 1 }, viewport_slug: 'desktop' },
  { type: 'region', region: null },
];

describe('rule scoping', () => {
  it('applies url_pattern rules per phase, viewport and enabled flag', () => {
    expect(isUrlIgnored(rules, 'https://example.com/private/a/b', 'capture')).toBe(true);
    expect(isUrlIgnored(rules, 'https://example.com/private/a/b', 'compare')).toBe(true);
    expect(isUrlIgnored(rules, 'https://example.com/live/feed', 'capture')).toBe(false);
    expect(isUrlIgnored(rules, 'https://example.com/live/feed', 'compare')).toBe(true);
    expect(isUrlIgnored(rules, 'https://example.com/slow/x', 'capture')).toBe(true);
    expect(isUrlIgnored(rules, 'https://example.com/slow/x', 'compare')).toBe(false);
    expect(isUrlIgnored(rules, 'https://example.com/off/x', 'capture')).toBe(false);
    expect(isUrlIgnored(rules, 'https://example.com/m/x', 'capture')).toBe(true);
    expect(isUrlIgnored(rules, 'https://example.com/m/x', 'capture', 'mobile')).toBe(true);
    expect(isUrlIgnored(rules, 'https://example.com/m/x', 'capture', 'desktop')).toBe(false);
    expect(matchingUrlRules(rules, 'https://example.com/other', 'capture')).toEqual([]);
  });

  it('collects selectors for the URL and viewport', () => {
    expect(selectorsFor(rules, 'https://example.com/', 'desktop')).toEqual(['.chat-widget']);
    expect(selectorsFor(rules, 'https://example.com/news/1', 'mobile')).toEqual([
      '.chat-widget',
      '.ad',
      '.carousel',
    ]);
  });

  it('collects regions for the URL and viewport', () => {
    expect(regionsFor(rules, 'https://example.com/', 'mobile')).toEqual([
      { x: 0, y: 0, width: 10, height: 10 },
    ]);
    expect(regionsFor(rules, 'https://example.com/', 'desktop')).toHaveLength(2);
  });
});
