import 'server-only';
import type { ProjectRole } from '@vrt/shared';
import { createClient } from '../supabase/server';
import { invitationState, type InvitationState } from '../invitations/token';

export interface MemberRow {
  userId: string;
  email: string;
  fullName: string | null;
  role: ProjectRole;
  disabled: boolean;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: ProjectRole | null;
  state: Exclude<InvitationState, 'accepted'>;
  expiresAt: string;
}

/** Project by slug, as the signed-in user sees it (RLS). */
export async function getProjectBySlug(slug: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects_public')
    .select('id, slug, name')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`Could not load the project: ${error.message}`);
  return data?.id && data.slug && data.name
    ? { id: data.id, slug: data.slug, name: data.name }
    : null;
}

/** Members (viewer+) and pending invitations (project admins only, via RLS) of a project. */
export async function listProjectMembers(projectId: string) {
  const supabase = await createClient();
  const [members, invitations] = await Promise.all([
    supabase
      .from('project_members')
      .select('user_id, role, profiles(email, full_name, disabled_at)')
      .eq('project_id', projectId),
    supabase
      .from('invitations')
      .select('id, email, role, accepted_at, expires_at')
      .eq('project_id', projectId)
      .is('accepted_at', null)
      .order('created_at', { ascending: false }),
  ]);
  if (members.error) throw new Error(`Could not load members: ${members.error.message}`);
  if (invitations.error) {
    throw new Error(`Could not load invitations: ${invitations.error.message}`);
  }
  const memberRows: MemberRow[] = members.data
    .map((row) => ({
      userId: row.user_id,
      email: row.profiles?.email ?? row.user_id,
      fullName: row.profiles?.full_name ?? null,
      role: row.role,
      disabled: Boolean(row.profiles?.disabled_at),
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
  const invitationRows: InvitationRow[] = invitations.data.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    state: invitationState(row) === 'pending' ? 'pending' : 'expired',
    expiresAt: row.expires_at,
  }));
  return { members: memberRows, invitations: invitationRows };
}
