import puppeteer, { type Browser, type BrowserWorker, type Page } from '@cloudflare/puppeteer';
import { BROWSER_SESSION_KEEP_ALIVE_MS } from '@vrt/shared';
import {
  lazyLoadScript,
  type BrowserProvider,
  type BrowserSession,
  type CaptureJob,
  type CaptureResult,
} from '@vrt/engine';
import type { Logger } from '../logger';

/**
 * `BrowserProvider` over Cloudflare Browser Rendering (05 §4, 06 §3). Sessions are reused: an
 * idle session (no worker connected) is picked up with `connect`; otherwise a new one is launched
 * with `keep_alive`. A healthy session is only disconnected on close so the next message can reuse
 * it; a session whose capture failed is closed for good.
 */
export class BrowserRenderingProvider implements BrowserProvider {
  constructor(
    private readonly binding: BrowserWorker,
    private readonly log: Logger,
  ) {}

  async openSession(): Promise<BrowserSession> {
    return new BrowserRenderingSession(await this.connectOrLaunch());
  }

  private async connectOrLaunch(): Promise<Browser> {
    try {
      const idle = (await puppeteer.sessions(this.binding)).filter((s) => !s.connectionId);
      for (const { sessionId } of idle) {
        try {
          return await puppeteer.connect(this.binding, sessionId);
        } catch (err) {
          // Another consumer took it first, or it just expired.
          this.log.debug('browser session reuse failed', { sessionId, err });
        }
      }
    } catch (err) {
      this.log.warn('listing browser sessions failed', { err });
    }
    return puppeteer.launch(this.binding, { keep_alive: BROWSER_SESSION_KEEP_ALIVE_MS });
  }
}

class BrowserRenderingSession implements BrowserSession {
  private broken = false;

  constructor(private readonly browser: Browser) {}

  async capture(job: CaptureJob): Promise<CaptureResult> {
    let page: Page | undefined;
    try {
      page = await this.browser.newPage();
      return await capturePage(page, job);
    } catch (err) {
      this.broken = true;
      throw err;
    } finally {
      await page?.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    try {
      if (this.broken) await this.browser.close();
      else await this.browser.disconnect();
    } catch {
      // the session is gone either way
    }
  }
}

/** 05 §4 steps 1–6 on a fresh page. */
export async function capturePage(page: Page, job: CaptureJob): Promise<CaptureResult> {
  const { viewport } = job;
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
  });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  if (job.basicAuth) await page.authenticate(job.basicAuth);

  await page.goto(job.url, { waitUntil: 'networkidle2', timeout: job.pageTimeoutMs });
  await page.addStyleTag({ content: job.css });
  await page.evaluate(`(${lazyLoadScript()})()`);
  await page.mouse.move(0, 0);
  await new Promise((resolve) => setTimeout(resolve, job.settleMs));

  const documentHeight = (await page.evaluate(
    'Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight)',
  )) as number;
  const truncated = documentHeight > job.maxPageHeight;
  const png = truncated
    ? await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: viewport.width, height: job.maxPageHeight },
        captureBeyondViewport: true,
      })
    : await page.screenshot({ type: 'png', fullPage: true });
  return { png: new Uint8Array(png), truncated };
}
