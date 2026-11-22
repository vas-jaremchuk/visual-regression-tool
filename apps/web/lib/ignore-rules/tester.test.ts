import { describe, expect, it } from 'vitest';
import { matchRules, type TestableRule } from './tester';

const rule = (id: string, patch: Partial<TestableRule>): TestableRule => ({
  id,
  type: 'url_pattern',
  urlPattern: null,
  viewportSlug: null,
  appliesTo: 'both',
  enabled: true,
  ...patch,
});

const RULES = [
  rule('blog', { urlPattern: 'https://www.example.com/blog/**', appliesTo: 'capture' }),
  rule('one-level', { urlPattern: 'https://www.example.com/*/' }),
  rule('regex', { urlPattern: 're:/(cart|checkout)', appliesTo: 'compare' }),
  rule('chat', { type: 'selector' }),
  rule('header', {
    type: 'region',
    urlPattern: 'https://www.example.com/',
    viewportSlug: 'mobile',
  }),
  rule('off', { urlPattern: '**', enabled: false }),
];

const ids = (url: string, viewport: string | null = null) =>
  matchRules(RULES, url, viewport).map((m) => m.rule.id);

describe('pattern tester (F-IGNORE-2)', () => {
  it('matches globs and regexes against the full URL like the engine', () => {
    expect(ids('https://www.example.com/blog/2026/post/')).toEqual(['blog', 'chat', 'off']);
    expect(ids('https://www.example.com/about/')).toEqual(['one-level', 'chat', 'off']);
    expect(ids('https://shop.example.com/checkout?step=1')).toEqual(['regex', 'chat', 'off']);
  });

  it('applies rules without a pattern to every URL and filters by viewport', () => {
    expect(ids('https://www.example.com/')).toEqual(['chat', 'header', 'off']);
    expect(ids('https://www.example.com/', 'desktop')).toEqual(['chat', 'off']);
    expect(ids('https://www.example.com/', 'mobile')).toEqual(['chat', 'header', 'off']);
  });

  it('describes what each rule does', () => {
    const effects = Object.fromEntries(
      matchRules(RULES, 'https://www.example.com/blog/cart', 'mobile').map((m) => [
        m.rule.id,
        m.effect,
      ]),
    );
    expect(effects).toEqual({
      blog: 'not captured',
      regex: 'changes ignored when comparing',
      chat: 'element hidden before capture',
      off: 'not captured, changes ignored when comparing',
    });
    expect(matchRules(RULES, 'https://www.example.com/', 'mobile')[1]!.effect).toBe(
      'region masked before diff (mobile only)',
    );
  });

  it('matches nothing for an empty URL', () => {
    expect(ids('  ')).toEqual([]);
  });
});
