import { z } from 'zod';
import { PROJECT_DEFAULTS, PROJECT_LIMITS } from '../constants';
import { region } from './common';

/** Diff container `POST /diff` (09 §4), called by the worker with a bearer token. */

const key = z.string().min(1);
const dims = z.tuple([z.int().min(0), z.int().min(0)]);

export const diffRequest = z.object({
  bucket: z.string().min(1),
  beforeKey: key,
  afterKey: key,
  diffKey: key,
  threshold: z.number().min(PROJECT_LIMITS.diffThreshold.min).max(PROJECT_LIMITS.diffThreshold.max),
  changeThresholdPct: z
    .number()
    .min(PROJECT_LIMITS.changeThresholdPct.min)
    .max(PROJECT_LIMITS.changeThresholdPct.max),
  regions: z.array(region).default([]),
  /** Project `max_page_height`; taller images are rejected instead of diffed. */
  maxPageHeight: z
    .int()
    .min(PROJECT_LIMITS.maxPageHeight.min)
    .max(PROJECT_LIMITS.maxPageHeight.max)
    .default(PROJECT_DEFAULTS.maxPageHeight),
});
export type DiffRequest = z.input<typeof diffRequest>;

export const diffResponse = z.object({
  changed: z.boolean(),
  diffPct: z.number().min(0).max(100),
  diffPixels: z.int().min(0),
  totalPixels: z.int().min(0),
  beforeDims: dims,
  afterDims: dims,
  afterSha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type DiffResponse = z.infer<typeof diffResponse>;

export const containerHealthResponse = z.object({ ok: z.boolean() });
