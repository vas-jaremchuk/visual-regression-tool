import 'server-only';
import type { ProjectRole } from '@vrt/shared';
import { createAdminClient } from '../supabase/admin';
import { hashInvitationToken, invitationState, type InvitationState } from './token';

export interface InvitationSummary {
  id: string;
  email: string;
  role: ProjectRole | null;
  projectName: string | null;
  projectSlug: string | null;
  inviter: string | null;
  state: InvitationState;
}

/**
 * The invitation behind a link, read as the service because the visitor is usually not signed
 * in yet. Null when the token is unknown or the invitation was revoked (deleted).
 */
export async function findInvitation(token: string): Promise<InvitationSummary | null> {
  const { data } = await createAdminClient()
    .from('invitations')
    .select(
      'id, email, role, accepted_at, expires_at, projects(name, slug), inviter:profiles!invitations_invited_by_fkey(email, full_name)',
    )
    .eq('token_hash', await hashInvitationToken(token))
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    email: data.email,
    role: data.role,
    projectName: data.projects?.name ?? null,
    projectSlug: data.projects?.slug ?? null,
    inviter: data.inviter ? (data.inviter.full_name ?? data.inviter.email) : null,
    state: invitationState(data),
  };
}
