import { describe, expect, it } from 'vitest';
import { adminSettingsSlug } from './settings-paths';

describe('adminSettingsSlug', () => {
  it.each([
    ['/p/site/settings', 'site'],
    ['/p/site/settings/', 'site'],
    ['/p/site/settings/general', 'site'],
    ['/p/site/settings/danger', 'site'],
    ['/p/site/settings/members', null],
    ['/p/site', null],
    ['/p/site/runs', null],
    ['/p/site/settings/general/extra', null],
    ['/settings', null],
  ])('%s → %s', (path, slug) => {
    expect(adminSettingsSlug(path)).toBe(slug);
  });
});
