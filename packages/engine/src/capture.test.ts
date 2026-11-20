import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NORMALISE_CSS, buildInjectedCss, lazyLoadScript } from './capture';
import { FIXTURES } from './test/helpers';
import type { IgnoreRule } from './types';

describe('NORMALISE_CSS', () => {
  it('is verbatim from the prototype', () => {
    const src = fs.readFileSync(path.join(FIXTURES, '../prototype/take-screenshots.js'), 'utf8');
    const proto = src.match(/const NORMALISE_CSS = `([\s\S]*?)`;/)![1];
    expect(NORMALISE_CSS).toBe(proto);
  });
});

describe('buildInjectedCss', () => {
  const rules: IgnoreRule[] = [
    { type: 'selector', selector: '.chat' },
    { type: 'selector', selector: '.m-only', viewport_slug: 'mobile' },
    { type: 'selector', selector: '.hero', url_pattern: 'https://example.com/other' },
  ];

  it('appends extra CSS and hides selectors after NORMALISE_CSS', () => {
    const css = buildInjectedCss(
      { extra_css: 'body { background: #fff; }', hide_selectors: ['#clock', ' ', '.chat'] },
      rules,
      'https://example.com/',
      'desktop',
    );
    expect(css).toBe(
      [
        NORMALISE_CSS,
        'body { background: #fff; }',
        '#clock { visibility: hidden !important; }',
        '.chat { visibility: hidden !important; }',
      ].join('\n'),
    );
  });

  it('is just NORMALISE_CSS without settings or rules', () => {
    expect(buildInjectedCss({}, [], 'https://example.com/', 'desktop')).toBe(NORMALISE_CSS);
    expect(
      buildInjectedCss({ extra_css: '  ', hide_selectors: null }, [], 'https://x.test/', null),
    ).toBe(NORMALISE_CSS);
  });

  it('includes viewport-scoped selector rules only for that viewport', () => {
    expect(buildInjectedCss({}, rules, 'https://example.com/', 'mobile')).toContain('.m-only');
    expect(buildInjectedCss({}, rules, 'https://example.com/', 'desktop')).not.toContain('.m-only');
  });
});

describe('lazyLoadScript', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakePage(scrollHeight: number, imgs: object[]) {
    const scrolls: [string, number, number][] = [];
    const window = {
      scrollBy: (x: number, y: number) => scrolls.push(['by', x, y]),
      scrollTo: (x: number, y: number) => scrolls.push(['to', x, y]),
    };
    const document = { body: { scrollHeight }, querySelectorAll: () => imgs };
    return { window, document, scrolls };
  }

  function run(script: string, page: ReturnType<typeof fakePage>): Promise<void> {
    const fn = new Function('window', 'document', `return (${script})();`);
    return fn(page.window, page.document) as Promise<void>;
  }

  it('scrolls 600 px every 120 ms to the bottom, back to top, then waits for images', async () => {
    vi.useFakeTimers();
    const listeners: Record<string, () => void> = {};
    const loading = {
      complete: false,
      naturalWidth: 0,
      addEventListener: (ev: string, cb: () => void) => (listeners[ev] = cb),
    };
    const stuck = { complete: false, naturalWidth: 0, addEventListener: () => {} };
    const loaded = { complete: true, naturalWidth: 10, addEventListener: () => {} };
    const page = fakePage(1500, [loaded, loading, stuck]);
    let done = false;
    const p = run(lazyLoadScript(), page).then(() => (done = true));

    await vi.advanceTimersByTimeAsync(360);
    expect(page.scrolls).toEqual([
      ['by', 0, 600],
      ['by', 0, 600],
      ['by', 0, 600],
      ['to', 0, 0],
    ]);
    listeners.load!();
    await vi.advanceTimersByTimeAsync(4999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });

  it('accepts custom step, delay and image timeout', () => {
    const s = lazyLoadScript({ stepPx: 300, delayMs: 50, imageTimeoutMs: 1000 });
    expect(s).toContain('const step = 300, delay = 50;');
    expect(s).toContain('setTimeout(res, 1000)');
  });
});
