import type { Page } from '@cloudflare/puppeteer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureJob } from '@vrt/engine';
import { createLogger } from '../logger';

const puppeteer = vi.hoisted(() => ({ sessions: vi.fn(), connect: vi.fn(), launch: vi.fn() }));
vi.mock('@cloudflare/puppeteer', () => ({ default: puppeteer }));

const { BrowserRenderingProvider, capturePage } = await import('./browser-rendering-provider');

const job: CaptureJob = {
  url: 'https://site.test/about/',
  viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true },
  basicAuth: { username: 'staging', password: 's3cret' },
  css: '.ad { visibility: hidden !important; }',
  pageTimeoutMs: 30_000,
  settleMs: 0,
  maxPageHeight: 16_384,
};

function fakePage(documentHeight: number) {
  const calls: [string, ...unknown[]][] = [];
  const record =
    (name: string, result?: unknown) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return result;
    };
  const page = {
    setViewport: record('setViewport'),
    setExtraHTTPHeaders: record('setExtraHTTPHeaders'),
    authenticate: record('authenticate'),
    goto: record('goto'),
    addStyleTag: record('addStyleTag'),
    evaluate: async (script: string) => {
      calls.push(['evaluate', script]);
      return script.includes('scrollHeight)') && script.startsWith('Math.max')
        ? documentHeight
        : undefined;
    },
    mouse: { move: record('mouse.move') },
    screenshot: record('screenshot', new Uint8Array([1, 2, 3])),
    close: record('close'),
  };
  return { page: page as unknown as Page, calls };
}

describe('capturePage', () => {
  it('runs the 05 §4 steps in order', async () => {
    const { page, calls } = fakePage(2000);
    const result = await capturePage(page, job);
    expect(calls.map((c) => c[0])).toEqual([
      'setViewport',
      'setExtraHTTPHeaders',
      'authenticate',
      'goto',
      'addStyleTag',
      'evaluate',
      'mouse.move',
      'evaluate',
      'screenshot',
    ]);
    expect(calls[0]![1]).toEqual({
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    expect(calls[1]![1]).toEqual({ 'Accept-Language': 'en-US,en;q=0.9' });
    expect(calls[2]![1]).toEqual({ username: 'staging', password: 's3cret' });
    expect(calls[3]!.slice(1)).toEqual([
      'https://site.test/about/',
      { waitUntil: 'networkidle2', timeout: 30_000 },
    ]);
    expect(calls[4]![1]).toEqual({ content: job.css });
    expect(String(calls[5]![1])).toContain('window.scrollBy(0, step)');
    expect(calls[6]!.slice(1)).toEqual([0, 0]);
    expect(calls[8]![1]).toEqual({ type: 'png', fullPage: true });
    expect(result).toEqual({ png: new Uint8Array([1, 2, 3]), truncated: false });
  });

  it('skips authentication without credentials', async () => {
    const { page, calls } = fakePage(2000);
    await capturePage(page, { ...job, basicAuth: null });
    expect(calls.map((c) => c[0])).not.toContain('authenticate');
  });

  it('clips pages taller than max_page_height and marks them truncated', async () => {
    const { page, calls } = fakePage(20_000);
    const result = await capturePage(page, job);
    expect(calls.at(-1)![1]).toEqual({
      type: 'png',
      clip: { x: 0, y: 0, width: 390, height: 16_384 },
      captureBeyondViewport: true,
    });
    expect(result.truncated).toBe(true);
  });
});

describe('BrowserRenderingProvider', () => {
  const binding = { fetch } as unknown as Fetcher;
  const log = createLogger({}, () => {});

  function fakeBrowser(page = fakePage(1000).page) {
    return {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reuses an idle session and only disconnects from it when done', async () => {
    const browser = fakeBrowser();
    puppeteer.sessions.mockResolvedValue([
      { sessionId: 'busy', connectionId: 'c1' },
      { sessionId: 'taken' },
      { sessionId: 'idle' },
    ]);
    puppeteer.connect.mockImplementation(async (_b: unknown, id: string) => {
      if (id === 'taken') throw new Error('session already has a connection');
      return browser;
    });

    const session = await new BrowserRenderingProvider(binding, log).openSession();
    expect(puppeteer.connect.mock.calls.map((c) => c[1])).toEqual(['taken', 'idle']);
    expect(puppeteer.launch).not.toHaveBeenCalled();

    await session.capture(job);
    await session.close();
    expect(browser.disconnect).toHaveBeenCalled();
    expect(browser.close).not.toHaveBeenCalled();
  });

  it('launches a kept-alive session when none is idle, and kills it after a failed capture', async () => {
    const { page } = fakePage(1000);
    (page as unknown as { goto: () => Promise<never> }).goto = async () => {
      throw new Error('Navigation timeout of 30000 ms exceeded');
    };
    const browser = fakeBrowser(page);
    puppeteer.sessions.mockResolvedValue([]);
    puppeteer.launch.mockResolvedValue(browser);

    const session = await new BrowserRenderingProvider(binding, log).openSession();
    expect(puppeteer.launch).toHaveBeenCalledWith(binding, { keep_alive: 60_000 });

    await expect(session.capture(job)).rejects.toThrow('Navigation timeout');
    await session.close();
    expect(browser.close).toHaveBeenCalled();
    expect(browser.disconnect).not.toHaveBeenCalled();
  });
});
