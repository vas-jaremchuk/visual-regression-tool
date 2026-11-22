import { z } from 'zod';

/** Rows per audit log page. */
export const AUDIT_PAGE_SIZE = 50;

const optionalId = z.string().uuid().optional().catch(undefined);
const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
  .optional()
  .catch(undefined);

/** Audit log filters (F-ADMIN-2) from the page's search params; invalid values are dropped. */
export const auditFilters = z.object({
  project: optionalId,
  actor: optionalId,
  action: z
    .string()
    .trim()
    .max(100)
    .transform((value) => value || undefined)
    .optional()
    .catch(undefined),
  from: optionalDate,
  to: optionalDate,
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});
export type AuditFilters = z.infer<typeof auditFilters>;

export function parseAuditFilters(
  params: Record<string, string | string[] | undefined>,
): AuditFilters {
  const single = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  return auditFilters.parse(single);
}

/** `action` matches as a prefix (`run.` finds every run action); LIKE wildcards are escaped. */
export function actionPattern(action: string): string {
  return `${action.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Inclusive UTC day range as `[gte, lt)` timestamps. */
export function dateRange(filters: Pick<AuditFilters, 'from' | 'to'>) {
  const lt = filters.to
    ? new Date(Date.parse(`${filters.to}T00:00:00Z`) + 86_400_000).toISOString()
    : undefined;
  return { gte: filters.from ? `${filters.from}T00:00:00.000Z` : undefined, lt };
}

/** Search params for another page with the same filters. */
export function auditPageHref(path: string, filters: AuditFilters, page: number): string {
  const params = new URLSearchParams();
  for (const key of ['project', 'actor', 'action', 'from', 'to'] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
