import { NORMALISE_CSS, sha256Hex, type BrowserProvider, type CaptureJob } from '@vrt/engine';
import { assertPublicUrl, type CaptureMsg } from '@vrt/shared';
import { FakeObjectStore } from '@vrt/storage/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../logger';
import type { Limiter } from '../limiter/limiter';
import { FakeSupabase } from '../test/fake-supabase';
import { handleCaptureBatch } from '../queues/consumer';
import { processCaptureMessage, type CaptureDeps } from './consumer';
import { CaptureRepo } from './repo';

const PROJECT = '00000000-0000-4000-8000-000000000001';
const RUN = '00000000-0000-4000-8000-000000000002';
const HOME = '00000000-0000-4000-8000-0000000000a1';
const ABOUT = '00000000-0000-4000-8000-0000000000a2';
const ABOUT_MOBILE = '00000000-0000-4000-8000-0000000000a3';
const PDF = '00000000-0000-4000-8000-0000000000a4';
const LABEL = '2026-11-20_10-00-00';
const BUCKET = 'vrt-acme';
const NOW = new Date('2026-11-20T12:00:00.000Z');

/** Bytes with a valid PNG signature and IHDR header; enough for `pngSize`. */
function fakePng(width: number, height: number): Uint8Array {
  const png = new Uint8Array(33);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  png.set(new TextEncoder().encode('IHDR'), 12);
  const view = new DataView(png.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return png;
}

function item(id: string, fields: Record<string, unknown>) {
  return { id, run_id: RUN, status: 'pending', attempts: 0, error: null, ...fields };
}

function seed() {
  return new FakeSupabase({
    projects: [
      {
        id: PROJECT,
        r2_bucket: BUCKET,
        basic_auth_user: 'staging',
        basic_auth_pass_enc: 'enc:s3cret',
        capture_concurrency: 2,
        settle_ms: 0,
        page_timeout_ms: 30_000,
        max_page_height: 16_384,
        extra_css: '.chat { display: none }',
        hide_selectors: ['.clock'],
      },
    ],
    viewports: [
      {
        project_id: PROJECT,
        slug: 'desktop',
        width: 1280,
        height: 900,
        device_scale_factor: 1,
        is_mobile: false,
      },
      {
        project_id: PROJECT,
        slug: 'mobile',
        width: 390,
        height: 844,
        device_scale_factor: 3,
        is_mobile: true,
      },
    ],
    ignore_rules: [
      {
        project_id: PROJECT,
        type: 'selector',
        selector: '.ad',
        url_pattern: null,
        viewport_slug: null,
        applies_to: 'capture',
        enabled: true,
      },
      {
        project_id: PROJECT,
        type: 'selector',
        selector: '.compare-only',
        url_pattern: null,
        viewport_slug: null,
        applies_to: 'compare',
        enabled: true,
      },
    ],
    runs: [
      {
        id: RUN,
        project_id: PROJECT,
        label: LABEL,
        status: 'running',
        is_legacy: false,
        cancel_requested_at: null,
      },
    ],
    run_items: [
      item(HOME, {
        url: 'https://site.test/',
        kind: 'page',
        viewport_slug: 'desktop',
        filename: 'index.png',
      }),
      item(ABOUT, {
        url: 'https://site.test/about/',
        kind: 'page',
        viewport_slug: 'desktop',
        filename: 'about_.png',
      }),
      item(ABOUT_MOBILE, {
        url: 'https://site.test/about/',
        kind: 'page',
        viewport_slug: 'mobile',
        filename: 'about_.png',
      }),
      item(PDF, {
        url: 'https://site.test/report.pdf',
        kind: 'file',
        viewport_slug: null,
        filename: 'report.pdf.png',
      }),
    ],
  });
}

class FakeBrowser implements BrowserProvider {
  jobs: CaptureJob[] = [];
  opened = 0;
  closed = 0;
  /** Decides each capture; throw to fail it. */
  onCapture: (job: CaptureJob, n: number) => { png: Uint8Array; truncated: boolean } = () => ({
    png: fakePng(1280, 4000),
    truncated: false,
  });

  async openSession() {
    this.opened++;
    return {
      capture: async (job: CaptureJob) => {
        this.jobs.push(job);
        return this.onCapture(job, this.jobs.length);
      },
      close: async () => {
        this.closed++;
      },
    };
  }
}

class FakeLimiter implements Limiter {
  free = 1;
  held = 0;
  async acquire(_projectId: string, projectLimit: number) {
    if (this.free <= 0 || this.held >= projectLimit) return null;
    this.free--;
    this.held++;
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        this.free++;
        this.held--;
      },
    };
  }
}

let db: FakeSupabase;
let browser: FakeBrowser;
let store: FakeObjectStore;
let limiter: FakeLimiter;
let enqueued: { msg: CaptureMsg; delaySeconds: number }[];
let deps: CaptureDeps;

const pdfBody = new TextEncoder().encode('%PDF-1.7 report');

beforeEach(() => {
  db = seed();
  browser = new FakeBrowser();
  store = new FakeObjectStore();
  limiter = new FakeLimiter();
  enqueued = [];
  deps = {
    repo: new CaptureRepo(db.client),
    browser,
    store,
    limiter,
    fetcher: (async () =>
      new Response(pdfBody, {
        status: 200,
        headers: { 'content-type': 'application/pdf', etag: '"v1"' },
      })) as typeof fetch,
    assertUrl: async () => undefined,
    enqueue: async (msg, delaySeconds) => {
      enqueued.push({ msg, delaySeconds });
    },
    decrypt: async (payload) => payload.replace(/^enc:/, ''),
    log: createLogger({}, () => {}),
    now: () => NOW,
  };
});

const msg = (...itemIds: string[]): CaptureMsg => ({ v: 1, runId: RUN, itemIds });

/** Delivers re-enqueued messages until none are left, like the queue would after their delay. */
async function drain() {
  while (enqueued.length) await processCaptureMessage(enqueued.shift()!.msg, deps);
}

describe('processCaptureMessage', () => {
  it('captures pages and fingerprints files into R2 and the item rows', async () => {
    browser.onCapture = (job) => ({
      png: fakePng(job.viewport.width, 20_000),
      truncated: job.viewport.width === 390,
    });
    await processCaptureMessage(msg(HOME, ABOUT_MOBILE, PDF), deps);

    const home = db.row('run_items', HOME);
    const homeKey = `screenshots/${LABEL}/desktop/index.png`;
    const homePng = await store.get(BUCKET, homeKey);
    expect(home).toMatchObject({
      status: 'done',
      attempts: 1,
      r2_key: homeKey,
      width: 1280,
      height: 20_000,
      truncated: false,
      bytes: homePng.byteLength,
      sha256: sha256Hex(homePng),
      error: null,
      finished_at: NOW.toISOString(),
    });
    expect(await store.head(BUCKET, homeKey)).toMatchObject({ contentType: 'image/png' });
    expect(db.row('run_items', ABOUT_MOBILE)).toMatchObject({
      status: 'done',
      r2_key: `screenshots/${LABEL}/mobile/about_.png`,
      width: 390,
      truncated: true,
    });

    const pdfKey = `screenshots/${LABEL}/_files/report.pdf.txt`;
    expect(db.row('run_items', PDF)).toMatchObject({
      status: 'done',
      r2_key: pdfKey,
      sha256: sha256Hex(pdfBody),
      bytes: pdfBody.byteLength,
      http_status: 200,
      content_type: 'application/pdf',
      etag: '"v1"',
      last_modified: null,
      final_url: null,
    });
    expect(new TextDecoder().decode(await store.get(BUCKET, pdfKey))).toBe(
      [
        'url: https://site.test/report.pdf',
        `sha256: ${sha256Hex(pdfBody)}`,
        `size: ${pdfBody.byteLength}`,
        'status: 200',
        'content-type: application/pdf',
        'last-modified: ',
        'etag: "v1"',
        `fetched-at: ${NOW.toISOString()}`,
        '',
      ].join('\n'),
    );

    expect(db.rpcCalls).toEqual([{ name: 'refresh_run_counts', args: { p_run_id: RUN } }]);
    expect(browser.opened).toBe(1);
    expect(browser.closed).toBe(1);
    expect(limiter.free).toBe(1);
  });

  it('passes the project capture settings to the browser', async () => {
    await processCaptureMessage(msg(ABOUT_MOBILE), deps);
    const [job] = browser.jobs;
    expect(job).toMatchObject({
      url: 'https://site.test/about/',
      viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true },
      basicAuth: { username: 'staging', password: 's3cret' },
      pageTimeoutMs: 30_000,
      settleMs: 0,
      maxPageHeight: 16_384,
    });
    expect(job!.css.startsWith(NORMALISE_CSS)).toBe(true);
    expect(job!.css).toContain('.chat { display: none }');
    expect(job!.css).toContain('.clock { visibility: hidden !important; }');
    expect(job!.css).toContain('.ad { visibility: hidden !important; }');
    expect(job!.css).not.toContain('.compare-only');
  });

  it('retries a failing item up to 3 attempts, then marks it failed with the error', async () => {
    browser.onCapture = (job) => {
      if (job.url === 'https://site.test/')
        throw new Error('Navigation timeout of 30000 ms exceeded');
      return { png: fakePng(1280, 900), truncated: false };
    };
    await processCaptureMessage(msg(HOME, ABOUT), deps);

    expect(db.row('run_items', HOME)).toMatchObject({
      status: 'pending',
      attempts: 1,
      error: 'Navigation timeout of 30000 ms exceeded',
    });
    expect(db.row('run_items', ABOUT)).toMatchObject({ status: 'done', attempts: 1 });
    expect(enqueued).toEqual([{ msg: msg(HOME), delaySeconds: 10 }]);
    // The failed page's session was discarded; the next page got a fresh one.
    expect(browser.opened).toBe(2);
    expect(browser.closed).toBe(2);

    await processCaptureMessage(enqueued.shift()!.msg, deps);
    expect(db.row('run_items', HOME)).toMatchObject({ status: 'pending', attempts: 2 });
    expect(enqueued).toEqual([{ msg: msg(HOME), delaySeconds: 20 }]);

    await drain();
    expect(db.row('run_items', HOME)).toMatchObject({
      status: 'failed',
      attempts: 3,
      error: 'Navigation timeout of 30000 ms exceeded',
      finished_at: NOW.toISOString(),
    });
    expect(browser.jobs.filter((j) => j.url === 'https://site.test/')).toHaveLength(3);
  });

  it('fails an item whose viewport no longer exists without retrying', async () => {
    db.row('run_items', HOME).viewport_slug = 'tablet';
    await processCaptureMessage(msg(HOME), deps);
    expect(db.row('run_items', HOME)).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: 'Viewport "tablet" not found in project',
    });
    expect(enqueued).toEqual([]);
  });

  it('never opens a private page URL in the browser (SSRF guard, NFR-14)', async () => {
    db.row('run_items', HOME).url = 'http://169.254.169.254/latest/meta-data/';
    deps.assertUrl = (url) => assertPublicUrl(url);
    await processCaptureMessage(msg(HOME), deps);
    expect(db.row('run_items', HOME)).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: expect.stringContaining('169.254.169.254 is a private address'),
    });
    expect(browser.jobs).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  it('does not reprocess done items on redelivery', async () => {
    await processCaptureMessage(msg(HOME, PDF), deps);
    const fetches = browser.jobs.length;
    expect(db.row('run_items', HOME).status).toBe('done');

    await processCaptureMessage(msg(HOME, PDF), deps);
    expect(browser.jobs).toHaveLength(fetches);
    expect(browser.opened).toBe(1);
    expect(db.row('run_items', HOME).attempts).toBe(1);
    expect(db.row('run_items', PDF).attempts).toBe(1);
  });

  it('picks up items left processing by a crashed delivery', async () => {
    Object.assign(db.row('run_items', HOME), { status: 'processing', attempts: 1 });
    Object.assign(db.row('run_items', ABOUT), { status: 'processing', attempts: 3 });
    await processCaptureMessage(msg(HOME, ABOUT), deps);
    expect(db.row('run_items', HOME)).toMatchObject({ status: 'done', attempts: 2 });
    expect(db.row('run_items', ABOUT)).toMatchObject({
      status: 'failed',
      error: 'Capture did not finish after 3 attempts',
    });
    expect(browser.jobs.map((j) => j.url)).toEqual(['https://site.test/']);
  });

  it('skips the items of a cancelled run without capturing', async () => {
    db.row('runs', RUN).cancel_requested_at = NOW.toISOString();
    db.row('run_items', PDF).status = 'done';
    await processCaptureMessage(msg(HOME, ABOUT, PDF), deps);
    expect(db.rows('run_items').map((r) => [r.id, r.status])).toEqual([
      [HOME, 'skipped'],
      [ABOUT, 'skipped'],
      [ABOUT_MOBILE, 'pending'],
      [PDF, 'done'],
    ]);
    expect(browser.opened).toBe(0);
    expect(db.rpcCalls).toHaveLength(1);
  });

  it('stops at the next item when the run is cancelled mid-message', async () => {
    browser.onCapture = () => {
      db.row('runs', RUN).cancel_requested_at = NOW.toISOString();
      return { png: fakePng(1280, 900), truncated: false };
    };
    await processCaptureMessage(msg(HOME, ABOUT, ABOUT_MOBILE), deps);
    expect(db.row('run_items', HOME).status).toBe('done');
    expect(db.row('run_items', ABOUT).status).toBe('skipped');
    expect(db.row('run_items', ABOUT_MOBILE).status).toBe('skipped');
    expect(browser.jobs).toHaveLength(1);
    expect(limiter.free).toBe(1);
  });

  it('re-enqueues the message untouched when no limiter slot is free', async () => {
    limiter.free = 0;
    await processCaptureMessage(msg(HOME, PDF), deps);
    expect(enqueued).toEqual([{ msg: msg(HOME, PDF), delaySeconds: 15 }]);
    expect(db.row('run_items', HOME)).toMatchObject({ status: 'pending', attempts: 0 });
    expect(browser.opened).toBe(0);
  });

  it('does not take a browser slot for a message of files only', async () => {
    limiter.free = 0;
    await processCaptureMessage(msg(PDF), deps);
    expect(db.row('run_items', PDF).status).toBe('done');
    expect(browser.opened).toBe(0);
  });

  it('releases the slot and session when the database fails mid-message', async () => {
    browser.onCapture = () => {
      db.failNext = { table: 'run_items', message: 'connection reset' };
      return { png: fakePng(1280, 900), truncated: false };
    };
    await expect(processCaptureMessage(msg(HOME), deps)).rejects.toThrow(
      'update item: connection reset',
    );
    expect(limiter.free).toBe(1);
    expect(browser.closed).toBe(1);
  });
});

describe('handleCaptureBatch', () => {
  function message(body: unknown) {
    const m = {
      id: crypto.randomUUID(),
      body,
      attempts: 1,
      timestamp: NOW,
      acked: false,
      retried: false,
      ack() {
        m.acked = true;
      },
      retry() {
        m.retried = true;
      },
    };
    return m;
  }

  it('acks processed and invalid messages and retries failed ones', async () => {
    const ok = message(msg(PDF));
    const invalid = message({ v: 2, runId: RUN });
    const broken = message({
      v: 1,
      runId: '00000000-0000-4000-8000-0000000000ff',
      itemIds: [HOME],
    });
    const realGetRun = deps.repo.getRun.bind(deps.repo);
    deps.repo.getRun = async (runId) => {
      if (runId !== RUN) throw new Error('load run: timeout');
      return realGetRun(runId);
    };

    await handleCaptureBatch(
      { queue: 'vrt-capture', messages: [ok, invalid, broken] } as unknown as MessageBatch<unknown>,
      deps,
    );
    expect([ok.acked, invalid.acked, broken.acked]).toEqual([true, true, false]);
    expect(broken.retried).toBe(true);
    expect(db.row('run_items', PDF).status).toBe('done');
  });
});
