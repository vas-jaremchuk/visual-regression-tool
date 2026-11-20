import 'server-only';
import type { Json } from '@vrt/db';
import { DAY_MS, type ProjectRole } from '@vrt/shared';
import { assertCan } from '../auth/assert-can';
import type { CurrentUser } from '../auth/session';
import { emailSender } from '../email';
import type { EmailSender } from '../email/sender';
import { invitationEmail, memberAddedEmail } from '../email/templates';
import { serverEnv } from '../env';
import {
  hashInvitationToken,
  invitationState,
  inviteLink,
  newInvitationToken,
} from '../invitations/token';
import { createAdminClient } from '../supabase/admin';
import { createClient } from '../supabase/server';
import { RequestError } from './errors';

/** Invitations expire after 7 days (REQ-AUTH-6); matches the `invitations.expires_at` default. */
const INVITATION_TTL_MS = 7 * DAY_MS;

type UserClient = Awaited<ReturnType<typeof createClient>>;

/** Audit entry as the signed-in user (02 §2 audit_log). */
async function audit(
  supabase: UserClient,
  action: string,
  projectId: string | null,
  details: Record<string, Json>,
) {
  const { error } = await supabase.rpc('write_audit_log', {
    p_action: action,
    p_details: details,
    ...(projectId ? { p_project_id: projectId } : {}),
  });
  if (error) throw new Error(`Could not write the audit log: ${error.message}`);
}

function inviterName(user: CurrentUser): string {
  return user.fullName ?? user.email;
}

async function loadProject(supabase: UserClient, projectId: string) {
  const { data } = await supabase
    .from('projects_public')
    .select('id, slug, name')
    .eq('id', projectId)
    .maybeSingle();
  if (!data?.id || !data.slug || !data.name) {
    throw new RequestError(404, 'not_found', 'Project not found');
  }
  return { id: data.id, slug: data.slug, name: data.name };
}

export interface CreateInvitationInput {
  email: string;
  projectId: string | null;
  role: ProjectRole;
}

/**
 * Invites an email to a project (project admins) or to the platform (platform admins), 04 §4.
 * An existing user is added to the project directly and notified; anyone else gets an
 * invitation link. A pending invitation for the same email and project is replaced.
 */
export async function createInvitation(
  user: CurrentUser | null,
  input: CreateInvitationInput,
  sender: EmailSender = emailSender(),
): Promise<{ invitationId: string; status: 'invited' | 'added' }> {
  const actor = input.projectId
    ? await assertCan(user, 'member.manage', input.projectId)
    : await assertCan(user, 'user.manage', null);
  const supabase = await createClient();
  const project = input.projectId ? await loadProject(supabase, input.projectId) : null;
  const appUrl = serverEnv().APP_URL;

  // Profiles of other projects' users are hidden by RLS, so look the email up as the service.
  const { data: existing, error: lookupError } = await createAdminClient()
    .from('profiles')
    .select('id')
    .eq('email', input.email)
    .maybeSingle();
  if (lookupError) throw new Error(`Could not look up the user: ${lookupError.message}`);

  if (existing) {
    if (!project) {
      throw new RequestError(409, 'already_registered', `${input.email} already has an account`);
    }
    const { error: memberError } = await supabase
      .from('project_members')
      .upsert({ project_id: project.id, user_id: existing.id, role: input.role });
    if (memberError) throw new Error(`Could not add the member: ${memberError.message}`);
    const { data: invitation, error } = await supabase
      .from('invitations')
      .insert({
        email: input.email,
        project_id: project.id,
        role: input.role,
        invited_by: actor.id,
        accepted_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) throw new Error(`Could not record the invitation: ${error.message}`);
    await audit(supabase, 'member.add', project.id, {
      user_id: existing.id,
      email: input.email,
      role: input.role,
      invitation_id: invitation.id,
    });
    await sender.send(
      memberAddedEmail({
        to: input.email,
        inviter: inviterName(actor),
        project: { name: project.name, role: input.role },
        link: `${appUrl}/p/${project.slug}`,
      }),
    );
    return { invitationId: invitation.id, status: 'added' };
  }

  const replace = supabase
    .from('invitations')
    .delete()
    .eq('email', input.email)
    .is('accepted_at', null);
  const { data: replaced, error: replaceError } = await (
    project ? replace.eq('project_id', project.id) : replace.is('project_id', null)
  ).select('id');
  if (replaceError) throw new Error(`Could not replace the invitation: ${replaceError.message}`);

  const { token, tokenHash } = await newInvitationToken();
  const { data: invitation, error } = await supabase
    .from('invitations')
    .insert({
      email: input.email,
      project_id: project?.id ?? null,
      role: project ? input.role : null,
      invited_by: actor.id,
      token_hash: tokenHash,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not create the invitation: ${error.message}`);
  await audit(supabase, 'invitation.create', project?.id ?? null, {
    invitation_id: invitation.id,
    email: input.email,
    role: project ? input.role : null,
    replaced: replaced.length,
  });
  await sender.send(
    invitationEmail({
      to: input.email,
      inviter: inviterName(actor),
      project: project ? { name: project.name, role: input.role } : null,
      link: inviteLink(appUrl, token),
    }),
  );
  return { invitationId: invitation.id, status: 'invited' };
}

/** Loads an invitation as the service so callers without access get 403, not 404. */
async function loadInvitationForManage(user: CurrentUser | null, invitationId: string) {
  const { data: invitation } = await createAdminClient()
    .from('invitations')
    .select('id, email, project_id, role, accepted_at, expires_at')
    .eq('id', invitationId)
    .maybeSingle();
  const actor = invitation?.project_id
    ? await assertCan(user, 'member.manage', invitation.project_id)
    : await assertCan(user, 'user.manage', null);
  if (!invitation) throw new RequestError(404, 'not_found', 'Invitation not found');
  if (invitation.accepted_at) {
    throw new RequestError(409, 'accepted', 'The invitation has already been accepted');
  }
  return { actor, invitation };
}

/** Sends a new link and restarts the 7-day expiry; the old link stops working (04 §4). */
export async function resendInvitation(
  user: CurrentUser | null,
  invitationId: string,
  sender: EmailSender = emailSender(),
): Promise<void> {
  const { actor, invitation } = await loadInvitationForManage(user, invitationId);
  const supabase = await createClient();
  const project = invitation.project_id ? await loadProject(supabase, invitation.project_id) : null;
  const { token, tokenHash } = await newInvitationToken();
  const { error } = await supabase
    .from('invitations')
    .update({
      token_hash: tokenHash,
      invited_by: actor.id,
      expires_at: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
    })
    .eq('id', invitation.id);
  if (error) throw new Error(`Could not resend the invitation: ${error.message}`);
  await audit(supabase, 'invitation.resend', invitation.project_id, {
    invitation_id: invitation.id,
    email: invitation.email,
  });
  await sender.send(
    invitationEmail({
      to: invitation.email,
      inviter: inviterName(actor),
      project: project && invitation.role ? { name: project.name, role: invitation.role } : null,
      link: inviteLink(serverEnv().APP_URL, token),
    }),
  );
}

/** Deletes a pending invitation; its link then shows "invalid or revoked" (REQ-AUTH-6). */
export async function revokeInvitation(user: CurrentUser | null, invitationId: string) {
  const { invitation } = await loadInvitationForManage(user, invitationId);
  const supabase = await createClient();
  const { error } = await supabase.from('invitations').delete().eq('id', invitation.id);
  if (error) throw new Error(`Could not revoke the invitation: ${error.message}`);
  await audit(supabase, 'invitation.revoke', invitation.project_id, {
    invitation_id: invitation.id,
    email: invitation.email,
  });
}

export async function changeMemberRole(
  user: CurrentUser | null,
  projectId: string,
  memberId: string,
  role: ProjectRole,
) {
  await assertCan(user, 'member.manage', projectId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_members')
    .update({ role })
    .eq('project_id', projectId)
    .eq('user_id', memberId)
    .select('user_id');
  if (error) throw new Error(`Could not change the role: ${error.message}`);
  if (data.length === 0) throw new RequestError(404, 'not_found', 'Member not found');
  await audit(supabase, 'member.update_role', projectId, { user_id: memberId, role });
}

export async function removeMember(user: CurrentUser | null, projectId: string, memberId: string) {
  await assertCan(user, 'member.manage', projectId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', memberId)
    .select('user_id, role');
  if (error) throw new Error(`Could not remove the member: ${error.message}`);
  if (data.length === 0) throw new RequestError(404, 'not_found', 'Member not found');
  await audit(supabase, 'member.remove', projectId, { user_id: memberId, role: data[0]!.role });
}

export type AcceptResult =
  | { status: 'accepted'; projectSlug: string | null }
  | { status: 'invalid' | 'expired' | 'already_accepted' | 'wrong_account'; email?: string };

/**
 * Accepts an invitation for the signed-in user (04 §4): creates the membership and sets
 * `accepted_at`. The invitation is addressed to one email; other accounts cannot use it.
 */
export async function acceptInvitation(user: CurrentUser, token: string): Promise<AcceptResult> {
  const admin = createAdminClient();
  const { data: invitation } = await admin
    .from('invitations')
    .select('id, email, project_id, role, accepted_at, expires_at, projects(slug)')
    .eq('token_hash', await hashInvitationToken(token))
    .maybeSingle();
  if (!invitation) return { status: 'invalid' };
  const state = invitationState(invitation);
  if (state === 'accepted') return { status: 'already_accepted' };
  if (state === 'expired') return { status: 'expired' };
  if (invitation.email !== user.email.toLowerCase()) {
    return { status: 'wrong_account', email: invitation.email };
  }

  if (invitation.project_id && invitation.role) {
    // An existing membership keeps its role.
    const { error } = await admin
      .from('project_members')
      .upsert(
        { project_id: invitation.project_id, user_id: user.id, role: invitation.role },
        { ignoreDuplicates: true },
      );
    if (error) throw new Error(`Could not add you to the project: ${error.message}`);
  }
  const { data: updated, error } = await admin
    .from('invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invitation.id)
    .is('accepted_at', null)
    .select('id');
  if (error) throw new Error(`Could not accept the invitation: ${error.message}`);
  if (updated.length === 0) return { status: 'already_accepted' };

  // The accepting user may not be allowed to call write_audit_log (platform invitations), so
  // the entry is written as the service with the user as actor.
  const { error: auditError } = await admin.from('audit_log').insert({
    actor_id: user.id,
    project_id: invitation.project_id,
    action: invitation.project_id ? 'member.add' : 'invitation.accept',
    details: {
      user_id: user.id,
      email: invitation.email,
      role: invitation.role,
      invitation_id: invitation.id,
      via: 'invitation',
    },
  });
  if (auditError) throw new Error(`Could not write the audit log: ${auditError.message}`);
  return { status: 'accepted', projectSlug: invitation.projects?.slug ?? null };
}

/** Platform admins: disable/enable a user (REQ-AUTH-4). */
export async function setUserDisabled(user: CurrentUser | null, userId: string, disabled: boolean) {
  const actor = await assertCan(user, 'user.manage', null);
  if (disabled && userId === actor.id) {
    throw new RequestError(422, 'self', 'You cannot disable your own account');
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .update({ disabled_at: disabled ? new Date().toISOString() : null })
    .eq('id', userId)
    .select('email');
  if (error) throw new Error(`Could not update the user: ${error.message}`);
  if (data.length === 0) throw new RequestError(404, 'not_found', 'User not found');
  await audit(supabase, disabled ? 'user.disable' : 'user.enable', null, {
    user_id: userId,
    email: data[0]!.email,
  });
}

/** Platform admins: promote/demote platform admin. */
export async function setPlatformAdmin(user: CurrentUser | null, userId: string, admin: boolean) {
  const actor = await assertCan(user, 'user.manage', null);
  if (!admin && userId === actor.id) {
    throw new RequestError(422, 'self', 'You cannot remove your own platform admin role');
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .update({ is_platform_admin: admin })
    .eq('id', userId)
    .select('email');
  if (error) throw new Error(`Could not update the user: ${error.message}`);
  if (data.length === 0) throw new RequestError(404, 'not_found', 'User not found');
  await audit(supabase, admin ? 'user.promote_admin' : 'user.demote_admin', null, {
    user_id: userId,
    email: data[0]!.email,
  });
}
