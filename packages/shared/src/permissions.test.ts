import { describe, expect, it } from 'vitest';
import type { ProjectRole } from './contracts/enums';
import { can, permissionAction, type PermissionAction } from './permissions';

const subject = (projectRole: ProjectRole | null, isPlatformAdmin = false, disabled = false) => ({
  projectRole,
  isPlatformAdmin,
  disabled,
});

// 04 §3, one row per action: [viewer, editor, project admin, platform admin]
const matrix: [PermissionAction, boolean, boolean, boolean, boolean][] = [
  ['project.view', true, true, true, true],
  ['sitemap.manage', false, true, true, true],
  ['run.manage', false, true, true, true],
  ['comparison.start', false, true, true, true],
  ['comparison.review', false, true, true, true],
  ['baseline.set', false, true, true, true],
  ['ignore_rule.manage', false, true, true, true],
  ['share_link.manage', false, true, true, true],
  ['project.settings', false, false, true, true],
  ['member.manage', false, false, true, true],
  ['run.delete', false, false, true, true],
  ['legacy.import', false, false, true, true],
  ['project.archive', false, false, false, true],
  ['project.create', false, false, false, true],
  ['user.manage', false, false, false, true],
];

describe('can', () => {
  it('covers every action', () => {
    expect(matrix.map(([action]) => action).sort()).toEqual([...permissionAction.options].sort());
  });

  it.each(matrix)('%s', (action, viewer, editor, admin, platform) => {
    expect(can(subject('viewer'), action)).toBe(viewer);
    expect(can(subject('editor'), action)).toBe(editor);
    expect(can(subject('admin'), action)).toBe(admin);
    expect(can(subject(null, true), action)).toBe(platform);
  });

  it('denies non-members everything', () => {
    for (const action of permissionAction.options) expect(can(subject(null), action)).toBe(false);
  });

  it('denies disabled users everything, platform admins included', () => {
    for (const action of permissionAction.options) {
      expect(can(subject('admin', true, true), action)).toBe(false);
    }
  });
});
