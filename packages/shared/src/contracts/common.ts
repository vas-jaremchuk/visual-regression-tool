import { z } from 'zod';

export const id = z.uuid();

/** Error body for every custom endpoint (09). */
export const apiErrorCode = z.enum([
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'business_rule',
  'internal_error',
]);
export type ApiErrorCode = z.infer<typeof apiErrorCode>;

export const apiErrorResponse = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponse>;

/** HTTP status for each well-known error code. */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  business_rule: 422,
  internal_error: 500,
};

/** For endpoints that take no body. */
export const emptyBody = z.object({}).strict();

export const okResponse = z.object({ ok: z.literal(true) });

/** Runs have a UTC label `YYYY-MM-DD_HH-MM-SS`, optionally `-N` on collision (F-RUN-2). */
export const runLabel = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d+)?$/, 'Expected YYYY-MM-DD_HH-MM-SS');

export const viewportSlug = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, digits and dashes');

export const httpUrl = z.url({ protocol: /^https?$/, error: 'Expected an http(s) URL' });

export const region = z.object({
  x: z.int().min(0),
  y: z.int().min(0),
  width: z.int().min(1),
  height: z.int().min(1),
});
export type Region = z.infer<typeof region>;
