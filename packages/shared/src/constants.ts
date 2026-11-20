/** Platform defaults and limits. Cloudflare product limits are configurable constants (06). */

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

// Viewports (02 §2 viewports)
export interface ViewportPreset {
  slug: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
}

export const DEFAULT_VIEWPORT: ViewportPreset = {
  slug: 'desktop',
  width: 1280,
  height: 900,
  deviceScaleFactor: 1,
  isMobile: false,
};

export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  DEFAULT_VIEWPORT,
  { slug: 'tablet', width: 768, height: 1024, deviceScaleFactor: 1, isMobile: false },
  { slug: 'mobile', width: 390, height: 844, deviceScaleFactor: 1, isMobile: true },
];

/** Viewport slug assumed for legacy prototype runs. */
export const LEGACY_VIEWPORT_SLUG = 'desktop';

// Per-project setting defaults (02 §2 projects) and their min/max (03 §6)
export const PROJECT_DEFAULTS = {
  checkRedirects: true,
  captureConcurrency: 2,
  settleMs: 3000,
  pageTimeoutMs: 30_000,
  maxPageHeight: 16_384,
  diffThreshold: 0.1,
  changeThresholdPct: 0.05,
} as const;

export const PROJECT_LIMITS = {
  captureConcurrency: { min: 1, max: 10 },
  settleMs: { min: 0, max: 60_000 },
  pageTimeoutMs: { min: 5_000, max: 180_000 },
  maxPageHeight: { min: 1_000, max: 32_768 },
  diffThreshold: { min: 0, max: 1 },
  changeThresholdPct: { min: 0, max: 100 },
  viewportWidth: { min: 200, max: 3_840 },
  viewportHeight: { min: 200, max: 4_320 },
  deviceScaleFactor: { min: 1, max: 3 },
} as const;

// Engine (05)
export const REDIRECT_CHECK_CONCURRENCY = 8;
export const REDIRECT_MAX_HOPS = 10;
export const REDIRECT_TIMEOUT_MS = 15 * SECOND_MS;
export const SITEMAP_FETCH_TIMEOUT_MS = 15 * SECOND_MS;
export const SITEMAP_MAX_DEPTH = 3;
export const FILE_FETCH_TIMEOUT_MS = 120 * SECOND_MS;
export const FILE_FETCH_MAX_ATTEMPTS = 3;
export const IMAGE_LOAD_TIMEOUT_MS = 5 * SECOND_MS;

// Jobs (06)
export const CAPTURE_BATCH_SIZE = 10;
export const DIFF_BATCH_SIZE = 5;
export const ITEM_MAX_ATTEMPTS = 3;
/** Re-enqueue delay is `attempts × ITEM_RETRY_DELAY_MS`. */
export const ITEM_RETRY_DELAY_MS = 10 * SECOND_MS;
export const JOB_POLL_INTERVAL_MS = 15 * SECOND_MS;
export const RUN_HARD_TIMEOUT_MS = 6 * HOUR_MS;
export const DIFF_MAX_ATTEMPTS = 3;
/** The diff container rejects pairs whose padded size exceeds this (64 MP). */
export const DIFF_MAX_PIXELS = 64_000_000;
export const BROWSER_SESSION_KEEP_ALIVE_MS = 60 * SECOND_MS;

// R2 (NFR-9)
export const R2_MAX_ATTEMPTS = 5;
/** Backoff is `attempt × R2_RETRY_BACKOFF_MS`. */
export const R2_RETRY_BACKOFF_MS = 2 * SECOND_MS;
export const SIGNED_URL_TTL_MS = HOUR_MS;

// Storage (F-STORAGE-1, prototype storage.js)
export const FREE_TIER_BYTES = 10 * 1024 ** 3;

// Auth & sharing (04)
export const HMAC_MAX_SKEW_MS = 5 * MINUTE_MS;
export const INVITATION_TTL_MS = 7 * DAY_MS;
export const SHARE_LINK_DEFAULT_DAYS = 30;
export const SHARE_TOKEN_BYTES = 32;

// UI hints (F-SITEMAP-5, F-CMP-3)
export const SNAPSHOT_STALE_AFTER_MS = 7 * DAY_MS;
export const SEVERITY_HIGH_PCT = 5;
export const SEVERITY_MID_PCT = 1;

// Rate limits (NFR-17)
export const JOB_START_RATE_LIMIT_PER_MINUTE = 10;
