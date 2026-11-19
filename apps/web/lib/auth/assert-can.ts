import 'server-only';
import { can, projectRole, type PermissionAction } from '@vrt/shared';
import { createClient } from '../supabase/server';
import type { CurrentUser } from './session';

export class ForbiddenError extends Error {
  readonly status = 403;

  constructor(action: PermissionAction) {
    super(`You do not have permission to ${action}`);
    this.name = 'ForbiddenError';
  }
}

/**
 * Server-side permission check (04 §3, REQ-AUTH-5). Call in every route and server action before
 * mutating, in addition to RLS. `projectId` is null for platform-level actions.
 */
export async function assertCan(
  user: CurrentUser | null,
  action: PermissionAction,
  projectId: string | null,
): Promise<CurrentUser> {
  if (!user) throw new ForbiddenError(action);
  let role = null;
  if (projectId && !user.isPlatformAdmin) {
    const supabase = await createClient();
    const { data } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();
    role = data ? projectRole.parse(data.role) : null;
  }
  // getCurrentUser only returns enabled users, so `disabled` is always false here.
  if (!can({ isPlatformAdmin: user.isPlatformAdmin, disabled: false, projectRole: role }, action)) {
    throw new ForbiddenError(action);
  }
  return user;
}
