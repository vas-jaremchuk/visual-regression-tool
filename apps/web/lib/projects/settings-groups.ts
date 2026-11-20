import { projectSettingsSchema, type ProjectSettings } from '@vrt/shared';
import type { z } from 'zod';

/**
 * Settings tabs backed by `projectSettingsSchema` fields (03 §6). Pure and client-safe: the forms
 * validate with it for inline errors and the server actions validate again before saving.
 */

export type SettingsField = keyof ProjectSettings;

export type FieldKind = 'text' | 'url' | 'textarea' | 'number' | 'boolean' | 'lines';

export interface FieldSpec {
  name: SettingsField;
  label: string;
  kind: FieldKind;
  hint?: string;
  step?: number;
}

export const SETTINGS_GROUPS = {
  general: [
    { name: 'name', label: 'Name', kind: 'text' },
    {
      name: 'slug',
      label: 'Slug',
      kind: 'text',
      hint: 'Used in links. Read-only after the first run.',
    },
    { name: 'sitemapIndex', label: 'Sitemap index URL', kind: 'url' },
    { name: 'notes', label: 'Notes', kind: 'textarea' },
  ],
  storage: [
    {
      name: 'r2Bucket',
      label: 'R2 bucket',
      kind: 'text',
      hint: '3 to 63 lowercase letters, digits or dashes.',
    },
    {
      name: 'r2PublicUrl',
      label: 'R2 public URL',
      kind: 'url',
      hint: 'Public development URL of the bucket, e.g. https://pub-xxxx.r2.dev. Optional.',
    },
  ],
  access: [{ name: 'basicAuthUser', label: 'Basic auth user', kind: 'text' }],
  capture: [
    { name: 'captureConcurrency', label: 'Concurrency', kind: 'number', hint: 'Pages at once.' },
    { name: 'pageTimeoutMs', label: 'Page timeout (ms)', kind: 'number' },
    { name: 'settleMs', label: 'Settle wait (ms)', kind: 'number' },
    { name: 'maxPageHeight', label: 'Max page height (px)', kind: 'number' },
    { name: 'checkRedirects', label: 'Check redirects', kind: 'boolean' },
    {
      name: 'fileExtensions',
      label: 'File extensions override',
      kind: 'lines',
      hint: 'One extension per line, without the dot. Empty uses the default list.',
    },
    {
      name: 'hideSelectors',
      label: 'Hide selectors',
      kind: 'lines',
      hint: 'One CSS selector per line; matching elements are hidden before capture.',
    },
    { name: 'extraCss', label: 'Extra CSS', kind: 'textarea' },
  ],
  diff: [
    {
      name: 'diffThreshold',
      label: 'Per-pixel threshold (0 to 1)',
      kind: 'number',
      step: 0.01,
    },
    {
      name: 'changeThresholdPct',
      label: 'Change threshold (%)',
      kind: 'number',
      step: 0.01,
      hint: 'Pages whose changed pixels are at or below this share count as unchanged.',
    },
  ],
} as const satisfies Record<string, readonly FieldSpec[]>;

export type SettingsGroup = keyof typeof SETTINGS_GROUPS;

export function isSettingsGroup(value: string): value is SettingsGroup {
  return Object.hasOwn(SETTINGS_GROUPS, value);
}

/** Raw form state: strings for inputs, booleans for checkboxes. */
export type FormValues = Partial<Record<SettingsField, string | boolean>>;

export type FieldErrors = Partial<Record<string, string>>;

function groupSchema(group: SettingsGroup) {
  const mask: Partial<Record<SettingsField, true>> = {};
  for (const field of SETTINGS_GROUPS[group] as readonly FieldSpec[]) mask[field.name] = true;
  return projectSettingsSchema.pick(mask);
}

/** Converts one raw form value to the schema's input type. */
function toInput(kind: FieldKind, raw: string | boolean | undefined): unknown {
  if (kind === 'boolean') return raw === true;
  const text = typeof raw === 'string' ? raw : '';
  switch (kind) {
    case 'number':
      return text.trim() === '' ? Number.NaN : Number(text);
    case 'lines': {
      return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    }
    case 'text':
    case 'url':
    case 'textarea':
      return text.trim() === '' ? null : text.trim();
  }
}

/** Raw form values → schema input, before validation. */
export function formToInput(group: SettingsGroup, values: FormValues): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const field of SETTINGS_GROUPS[group] as readonly FieldSpec[]) {
    input[field.name] = toInput(field.kind, values[field.name]);
  }
  // An empty override list means "use the default extensions" (02 §2 projects).
  if (group === 'capture' && Array.isArray(input.fileExtensions)) {
    if (input.fileExtensions.length === 0) input.fileExtensions = null;
  }
  return input;
}

/** First message per field, keyed by the top-level field name. */
export function fieldErrorsOf(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!errors[key]) {
      errors[key] =
        issue.code === 'invalid_type' && issue.expected === 'number'
          ? 'Enter a number'
          : issue.code === 'invalid_type' && issue.expected === 'string'
            ? 'This field is required'
            : issue.message;
    }
  }
  return errors;
}

export type GroupValidation =
  { ok: true; data: Partial<ProjectSettings> } | { ok: false; fieldErrors: FieldErrors };

/** Validates one tab's form values with `projectSettingsSchema` (03 §6). */
export function validateSettingsGroup(group: SettingsGroup, values: FormValues): GroupValidation {
  const result = groupSchema(group).safeParse(formToInput(group, values));
  if (!result.success) return { ok: false, fieldErrors: fieldErrorsOf(result.error) };
  return { ok: true, data: result.data as Partial<ProjectSettings> };
}

/** Stored settings → raw form values for one tab. */
export function settingsToForm(group: SettingsGroup, settings: ProjectSettings): FormValues {
  const values: FormValues = {};
  for (const field of SETTINGS_GROUPS[group] as readonly FieldSpec[]) {
    const value = settings[field.name];
    if (field.kind === 'boolean') values[field.name] = Boolean(value);
    else if (Array.isArray(value)) values[field.name] = value.join('\n');
    else values[field.name] = value === null || value === undefined ? '' : String(value);
  }
  return values;
}
