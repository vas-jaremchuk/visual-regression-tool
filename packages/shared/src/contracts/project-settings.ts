import { z } from 'zod';
import { PROJECT_DEFAULTS, PROJECT_LIMITS } from '../constants';
import { httpUrl, viewportSlug } from './common';

/** Per-project settings edited in the UI (03 §6), with min/max for every number. */

const between = (key: keyof typeof PROJECT_LIMITS, label: string) => {
  const { min, max } = PROJECT_LIMITS[key];
  return z
    .number()
    .min(min, `${label} must be at least ${min}`)
    .max(max, `${label} must be at most ${max}`);
};

export const projectSlug = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, digits and single dashes');

export const r2BucketName = z
  .string()
  .regex(/^[a-z0-9-]{3,63}$/, 'Bucket names are 3–63 lowercase letters, digits or dashes');

export const fileExtension = z
  .string()
  .regex(/^[a-z0-9]{1,5}$/i, 'Extensions are 1–5 letters or digits, without the dot')
  .transform((ext) => ext.toLowerCase());

export const projectSettingsSchema = z.object({
  // General
  name: z.string().trim().min(1, 'Name is required').max(100),
  slug: projectSlug,
  sitemapIndex: httpUrl,
  notes: z.string().max(5000).nullable().default(null),
  // Storage
  r2Bucket: r2BucketName,
  r2PublicUrl: httpUrl.nullable().default(null),
  // Access (password is write-only, see projectSecretsSchema)
  basicAuthUser: z.string().max(200).nullable().default(null),
  // Capture
  checkRedirects: z.boolean().default(PROJECT_DEFAULTS.checkRedirects),
  captureConcurrency: between('captureConcurrency', 'Concurrency')
    .int()
    .default(PROJECT_DEFAULTS.captureConcurrency),
  settleMs: between('settleMs', 'Settle wait').int().default(PROJECT_DEFAULTS.settleMs),
  pageTimeoutMs: between('pageTimeoutMs', 'Page timeout')
    .int()
    .default(PROJECT_DEFAULTS.pageTimeoutMs),
  maxPageHeight: between('maxPageHeight', 'Max page height')
    .int()
    .default(PROJECT_DEFAULTS.maxPageHeight),
  fileExtensions: z.array(fileExtension).max(200).nullable().default(null),
  hideSelectors: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  extraCss: z.string().max(20_000).nullable().default(null),
  // Diff
  diffThreshold: between('diffThreshold', 'Per-pixel threshold').default(
    PROJECT_DEFAULTS.diffThreshold,
  ),
  changeThresholdPct: between('changeThresholdPct', 'Change threshold').default(
    PROJECT_DEFAULTS.changeThresholdPct,
  ),
});
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type ProjectSettingsInput = z.input<typeof projectSettingsSchema>;

/** Write-only secrets. `undefined` keeps the stored value, `null` clears it (Replace / Clear). */
export const projectSecretsSchema = z.object({
  basicAuthPass: z.string().min(1).max(500).nullable().optional(),
});

export const viewportSchema = z.object({
  slug: viewportSlug,
  width: between('viewportWidth', 'Width').int(),
  height: between('viewportHeight', 'Height').int(),
  deviceScaleFactor: between('deviceScaleFactor', 'Device scale factor').default(1),
  isMobile: z.boolean().default(false),
  enabled: z.boolean().default(true),
  sortOrder: z.int().min(0).default(0),
});
export type Viewport = z.infer<typeof viewportSchema>;
