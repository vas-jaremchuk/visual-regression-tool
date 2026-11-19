import { describe, expect, expectTypeOf, it } from 'vitest';
import { Constants, PACKAGE_NAME, type Tables } from './index';

describe('@vrt/db', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@vrt/db');
  });

  it('exports the enums of specification/02-data-model.md §1', () => {
    expect(Constants.public.Enums.project_role).toEqual(['admin', 'editor', 'viewer']);
    expect(Constants.public.Enums.cmp_item_status).toEqual([
      'pending',
      'changed',
      'unchanged',
      'new',
      'missing',
      'redirect',
      'error',
    ]);
  });

  it('types projects_public without the encrypted password', () => {
    type ProjectPublic = Tables<'projects_public'>;
    expectTypeOf<ProjectPublic>().toHaveProperty('has_basic_auth');
    expectTypeOf<ProjectPublic>().not.toHaveProperty('basic_auth_pass_enc');
  });
});
