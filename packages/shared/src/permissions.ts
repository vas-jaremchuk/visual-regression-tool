import { z } from 'zod';
import type { ProjectRole } from './contracts/enums';

/**
 * Permission matrix (04 §3). Every route/action checks one of these actions server-side with
 * `assertCan` in addition to RLS (REQ-AUTH-5). `minRole` is the lowest project role allowed;
 * `platform` means only platform admins.
 */
export const permissionAction = z.enum([
  'project.view',
  'sitemap.manage',
  'run.manage',
  'comparison.start',
  'comparison.review',
  'baseline.set',
  'ignore_rule.manage',
  'share_link.manage',
  'project.settings',
  'member.manage',
  'run.delete',
  'legacy.import',
  'project.archive',
  'project.create',
  'user.manage',
]);
export type PermissionAction = z.infer<typeof permissionAction>;

type Requirement = ProjectRole | 'platform';

export const PERMISSION_MATRIX: Record<PermissionAction, Requirement> = {
  'project.view': 'viewer',
  'sitemap.manage': 'editor',
  'run.manage': 'editor',
  'comparison.start': 'editor',
  'comparison.review': 'editor',
  'baseline.set': 'editor',
  'ignore_rule.manage': 'editor',
  'share_link.manage': 'editor',
  'project.settings': 'admin',
  'member.manage': 'admin',
  'run.delete': 'admin',
  'legacy.import': 'admin',
  'project.archive': 'platform',
  'project.create': 'platform',
  'user.manage': 'platform',
};

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, editor: 2, admin: 3 };

export interface PermissionSubject {
  isPlatformAdmin: boolean;
  /** Disabled users have no rights at all (REQ-AUTH-4). */
  disabled: boolean;
  /** The subject's role in the project the action targets, or null when not a member. */
  projectRole: ProjectRole | null;
}

export function can(subject: PermissionSubject, action: PermissionAction): boolean {
  if (subject.disabled) return false;
  if (subject.isPlatformAdmin) return true;
  const required = PERMISSION_MATRIX[action];
  if (required === 'platform' || subject.projectRole === null) return false;
  return ROLE_RANK[subject.projectRole] >= ROLE_RANK[required];
}
