import {
  ITEM_MAX_ATTEMPTS,
  ITEM_RETRY_DELAY_MS,
  LIMITER_BUSY_DELAY_MS,
  SECOND_MS,
  runItemKey,
  type CaptureMsg,
  type ObjectStore,
} from '@vrt/shared';
import {
  basicAuthHeader,
  buildInjectedCss,
  fingerprintUrl,
  formatFingerprint,
  pngSize,
  sha256Hex,
  type BasicAuthCredentials,
  type BrowserProvider,
  type BrowserSession,
  type Fetcher,
  type IgnoreRule,
} from '@vrt/engine';
import type { Logger } from '../logger';
import type { Limiter, LimiterSlot } from '../limiter/limiter';
import type {
  CaptureItem,
  CaptureProject,
  CaptureRepo,
  CaptureRun,
  CaptureViewportRow,
  ItemUpdate,
} from './repo';

/** Capture consumer for `vrt-capture` (06 §3, REQ-JOB-2; 05 §4–§5, REQ-ENG-4/5). */

export interface CaptureDeps {
  repo: CaptureRepo;
  browser: BrowserProvider;
  store: ObjectStore;
  limiter: Limiter;
  fetcher: Fetcher;
  /** Sends a message to `vrt-capture`. */
  enqueue(msg: CaptureMsg, delaySeconds: number): Promise<void>;
  /** Decrypts `projects.basic_auth_pass_enc`. */
  decrypt(payload: string): Promise<string>;
  log: Logger;
  now?: () => Date;
}

/** An item error that a retry cannot fix; the item fails on the first attempt. */
class PermanentItemError extends Error {}

/** Legacy items without a reconstructed URL (F-RUN-6) cannot be captured again. */
function urlOf(item: CaptureItem): string {
  if (item.url === null) throw new PermanentItemError(`Item ${item.filename} has no URL`);
  return item.url;
}

interface Context {
  run: CaptureRun;
  project: CaptureProject;
  viewports: Map<string, CaptureViewportRow>;
  rules: IgnoreRule[];
  basicAuth: BasicAuthCredentials | null;
}

const WORKABLE = new Set(['pending', 'processing']);

/**
 * Processes one message. Resolves when the message can be acked; throws on infrastructure errors
 * (database, R2) so the queue redelivers it. Redelivery is safe: final items are skipped and R2
 * PUTs overwrite.
 */
export async function processCaptureMessage(msg: CaptureMsg, deps: CaptureDeps): Promise<void> {
  const { repo, log: baseLog } = deps;
  const log = baseLog.child({ runId: msg.runId, step: 'capture' });

  const run = await repo.getRun(msg.runId);
  if (!run) {
    log.warn('run not found; dropping message');
    return;
  }
  if (run.status === 'cancelled' || run.cancel_requested_at) {
    await repo.skip(run.id, msg.itemIds);
    await repo.refreshCounts(run.id);
    log.info('run cancelled; items skipped', { items: msg.itemIds.length });
    return;
  }
  if (run.status !== 'queued' && run.status !== 'running') {
    log.warn('run is not active; dropping message', { status: run.status });
    return;
  }

  const items = (await repo.getItems(run.id, msg.itemIds)).filter((i) => WORKABLE.has(i.status));
  if (items.length === 0) return;

  const project = await repo.getProject(run.project_id);
  if (!project) {
    log.warn('project not found; dropping message', { projectId: run.project_id });
    return;
  }

  // One message holds one browser session, so it takes a limiter slot when it has pages (06 §2).
  let slot: LimiterSlot | null = null;
  if (items.some((i) => i.kind === 'page')) {
    slot = await deps.limiter.acquire(project.id, project.capture_concurrency);
    if (!slot) {
      await deps.enqueue(
        { v: 1, runId: run.id, itemIds: items.map((i) => i.id) },
        LIMITER_BUSY_DELAY_MS / SECOND_MS,
      );
      log.info('capture limit reached; message re-enqueued', { projectId: project.id });
      return;
    }
  }

  let session: BrowserSession | null = null;
  try {
    const ctx = await loadContext(run, project, deps);
    const claimed: CaptureItem[] = [];
    for (const item of items) {
      if (await repo.claim(item)) claimed.push({ ...item, attempts: item.attempts + 1 });
    }

    for (const [index, item] of claimed.entries()) {
      if (item.attempts > ITEM_MAX_ATTEMPTS) {
        // Every earlier delivery died mid-item (crash, wall-time limit): give up on it.
        await failItem(run, item, new Error('Capture did not finish after 3 attempts'), deps, log);
        continue;
      }
      if (await repo.isCancelled(run.id)) {
        await repo.skip(
          run.id,
          claimed.slice(index).map((i) => i.id),
        );
        log.info('run cancelled; remaining items skipped');
        break;
      }
      const itemLog = log.child({ projectId: project.id, itemId: item.id });
      let patch: ItemUpdate;
      try {
        if (item.kind === 'file') {
          patch = await captureFile(item, ctx, deps);
        } else {
          session ??= await deps.browser.openSession();
          patch = await capturePage(item, ctx, session, deps);
        }
      } catch (err) {
        if (item.kind === 'page' && session) {
          // 05 §4: a failed page discards its session; the next page gets a fresh one.
          await session.close();
          session = null;
        }
        await failItem(run, item, err, deps, itemLog);
        continue;
      }
      // Outside the try: a database error is not the item's fault, so the message is redelivered.
      await repo.update(item.id, patch);
    }
  } finally {
    await session?.close();
    await slot?.release();
    await repo.refreshCounts(run.id);
  }
}

async function loadContext(
  run: CaptureRun,
  project: CaptureProject,
  deps: CaptureDeps,
): Promise<Context> {
  const [viewports, rules] = await Promise.all([
    deps.repo.getViewports(project.id),
    deps.repo.getCaptureRules(project.id),
  ]);
  const basicAuth =
    project.basic_auth_user && project.basic_auth_pass_enc
      ? {
          username: project.basic_auth_user,
          password: await deps.decrypt(project.basic_auth_pass_enc),
        }
      : null;
  return { run, project, viewports: new Map(viewports.map((v) => [v.slug, v])), rules, basicAuth };
}

function keyFor(item: CaptureItem, run: CaptureRun): string {
  return runItemKey({
    runLabel: run.label,
    isLegacy: run.is_legacy,
    kind: item.kind,
    viewportSlug: item.viewport_slug,
    filename: item.filename,
  });
}

/** 05 §4: screenshot one page with the project's capture settings and store it in R2. */
async function capturePage(
  item: CaptureItem,
  ctx: Context,
  session: BrowserSession,
  deps: CaptureDeps,
): Promise<ItemUpdate> {
  const viewport = item.viewport_slug ? ctx.viewports.get(item.viewport_slug) : undefined;
  if (!viewport) {
    throw new PermanentItemError(`Viewport "${item.viewport_slug}" not found in project`);
  }
  const url = urlOf(item);
  const key = keyFor(item, ctx.run);
  const { png, truncated } = await session.capture({
    url,
    viewport: {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.device_scale_factor,
      isMobile: viewport.is_mobile,
    },
    basicAuth: ctx.basicAuth,
    css: buildInjectedCss(ctx.project, ctx.rules, url, item.viewport_slug),
    pageTimeoutMs: ctx.project.page_timeout_ms,
    settleMs: ctx.project.settle_ms,
    maxPageHeight: ctx.project.max_page_height,
  });
  const { width, height } = pngSize(png);
  await deps.store.put(ctx.project.r2_bucket, key, png, 'image/png');
  return {
    status: 'done',
    r2_key: key,
    width,
    height,
    truncated,
    bytes: png.byteLength,
    sha256: sha256Hex(png),
    error: null,
    finished_at: (deps.now?.() ?? new Date()).toISOString(),
  };
}

/** 05 §5: fingerprint a file link and store the prototype's `.txt` in R2. Never fails the item. */
async function captureFile(
  item: CaptureItem,
  ctx: Context,
  deps: CaptureDeps,
): Promise<ItemUpdate> {
  const url = urlOf(item);
  const key = keyFor(item, ctx.run);
  const headers: Record<string, string> = ctx.basicAuth
    ? { Authorization: basicAuthHeader(ctx.basicAuth.username, ctx.basicAuth.password) }
    : {};
  const fp = await fingerprintUrl(url, headers, deps.fetcher, { now: deps.now });
  await deps.store.put(
    ctx.project.r2_bucket,
    key,
    new TextEncoder().encode(formatFingerprint(fp)),
    'text/plain; charset=utf-8',
  );
  return {
    status: 'done',
    r2_key: key,
    sha256: fp.sha256,
    bytes: fp.size,
    http_status: fp.status || null,
    content_type: fp.contentType || null,
    last_modified: fp.lastModified || null,
    etag: fp.etag || null,
    final_url: fp.finalUrl || null,
    error: null,
    finished_at: (deps.now?.() ?? new Date()).toISOString(),
  };
}

/** 06 §3 step 5: back to `pending` with a delayed single-item message, or `failed` after 3 attempts. */
async function failItem(
  run: CaptureRun,
  item: CaptureItem,
  err: unknown,
  deps: CaptureDeps,
  log: Logger,
): Promise<void> {
  const error = err instanceof Error ? err.message : String(err);
  if (item.attempts < ITEM_MAX_ATTEMPTS && !(err instanceof PermanentItemError)) {
    await deps.repo.update(item.id, { status: 'pending', error });
    await deps.enqueue(
      { v: 1, runId: run.id, itemIds: [item.id] },
      (item.attempts * ITEM_RETRY_DELAY_MS) / SECOND_MS,
    );
    log.warn('item failed; retry scheduled', { attempts: item.attempts, err });
    return;
  }
  await deps.repo.update(item.id, {
    status: 'failed',
    error,
    finished_at: (deps.now?.() ?? new Date()).toISOString(),
  });
  log.error('item failed', { attempts: item.attempts, err });
}
