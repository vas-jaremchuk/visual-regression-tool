import type { ProjectSettings } from '@vrt/shared';

/** `projectSettingsSchema` field → `projects` column (02 §2). */
export const SETTINGS_COLUMNS = {
  name: 'name',
  slug: 'slug',
  sitemapIndex: 'sitemap_index',
  notes: 'notes',
  r2Bucket: 'r2_bucket',
  r2PublicUrl: 'r2_public_url',
  basicAuthUser: 'basic_auth_user',
  checkRedirects: 'check_redirects',
  captureConcurrency: 'capture_concurrency',
  settleMs: 'settle_ms',
  pageTimeoutMs: 'page_timeout_ms',
  maxPageHeight: 'max_page_height',
  fileExtensions: 'file_extensions',
  hideSelectors: 'hide_selectors',
  extraCss: 'extra_css',
  diffThreshold: 'diff_threshold',
  changeThresholdPct: 'change_threshold_pct',
} as const satisfies Record<keyof ProjectSettings, string>;

export type SettingsColumn = (typeof SETTINGS_COLUMNS)[keyof typeof SETTINGS_COLUMNS];

export const SETTINGS_SELECT = Object.values(SETTINGS_COLUMNS).join(', ');

/** Settings fields → a `projects` update/insert row. */
export function settingsToRow(settings: Partial<ProjectSettings>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(settings)) {
    if (value === undefined) continue;
    row[SETTINGS_COLUMNS[field as keyof ProjectSettings]] = value;
  }
  return row;
}

/** A `projects` / `projects_public` row → settings fields. */
export function rowToSettings(row: Record<string, unknown>): ProjectSettings {
  const settings: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(SETTINGS_COLUMNS)) {
    const value = row[column];
    settings[field] =
      typeof value === 'string' && /^(diff|change)_/.test(column) ? Number(value) : value;
  }
  return settings as ProjectSettings;
}
