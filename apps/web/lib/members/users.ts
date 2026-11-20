import 'server-only';
import type { ProjectRole } from '@vrt/shared';
import { invitationState } from '../invitations/token';
import { createClient } from '../supabase/server';

export interface UserRow {
  id: string;
  email: string;
  fullName: string | null;
  isPlatformAdmin: boolean;
  disabled: boolean;
  memberships: { projectName: string; role: ProjectRole }[];
}

export interface PlatformInvitationRow {
  id: string;
  email: string;
  state: 'pending' | 'expired';
  expiresAt: string;
}

/** Every user with their project memberships, and pending platform invitations (F-ADMIN-1). */
export async function listUsers() {
  const supabase = await createClient();
  const [profiles, invitations] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, email, full_name, is_platform_admin, disabled_at, project_members(role, projects(name))',
      )
      .order('email'),
    supabase
      .from('invitations')
      .select('id, email, accepted_at, expires_at')
      .is('project_id', null)
      .is('accepted_at', null)
      .order('created_at', { ascending: false }),
  ]);
  if (profiles.error) throw new Error(`Could not load users: ${profiles.error.message}`);
  if (invitations.error) {
    throw new Error(`Could not load invitations: ${invitations.error.message}`);
  }
  const users: UserRow[] = profiles.data.map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    isPlatformAdmin: row.is_platform_admin,
    disabled: row.disabled_at !== null,
    memberships: row.project_members
      .map((m) => ({ projectName: m.projects?.name ?? '', role: m.role }))
      .sort((a, b) => a.projectName.localeCompare(b.projectName)),
  }));
  const pending: PlatformInvitationRow[] = invitations.data.map((row) => ({
    id: row.id,
    email: row.email,
    state: invitationState(row) === 'pending' ? 'pending' : 'expired',
    expiresAt: row.expires_at,
  }));
  return { users, invitations: pending };
}
