import type { Json } from '@vrt/db';

/** Fields whose values never reach the audit log (F-PROJ-3, NFR-12). */
export const SECRET_FIELDS: ReadonlySet<string> = new Set(['basicAuthPass']);

export const REDACTED = '[redacted]';

type Change = { old: Json; new: Json };

function toJson(value: unknown): Json {
  return value === undefined ? null : (JSON.parse(JSON.stringify(value)) as Json);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Old/new pairs of the fields `next` changes, for the audit log (F-PROJ-3). Secret fields are
 * reported as set/cleared only: `[redacted]` stands for any stored value.
 */
export function settingsChanges(
  before: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, Change> {
  const changes: Record<string, Change> = {};
  for (const [field, value] of Object.entries(next)) {
    if (value === undefined) continue;
    if (SECRET_FIELDS.has(field)) {
      // A secret is write-only, so any new value counts as a change.
      changes[field] = {
        old: before[field] ? REDACTED : null,
        new: value === null ? null : REDACTED,
      };
    } else if (!same(before[field], value)) {
      changes[field] = { old: toJson(before[field]), new: toJson(value) };
    }
  }
  return changes;
}

/** A settings object with secret values replaced, e.g. for `project.create`. */
export function redactSecrets(values: Record<string, unknown>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [field, value] of Object.entries(values)) {
    if (value === undefined) continue;
    out[field] = SECRET_FIELDS.has(field) ? (value ? REDACTED : null) : toJson(value);
  }
  return out;
}
