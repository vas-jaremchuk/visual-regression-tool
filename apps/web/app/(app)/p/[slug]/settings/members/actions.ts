'use server';

import { createInvitationRequest, id, projectRole } from '@vrt/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/session';
import { runAction, type ActionResult } from '@/lib/members/action-result';
import { RequestError } from '@/lib/members/errors';
import {
  changeMemberRole,
  createInvitation,
  removeMember,
  resendInvitation,
  revokeInvitation,
} from '@/lib/members/service';

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new RequestError(400, 'validation', result.error.issues[0]?.message ?? 'Invalid input');
  }
  return result.data;
}

const MEMBERS_PATH = '/p/[slug]/settings/members';

export async function inviteMember(input: {
  projectId: string;
  email: string;
  role: string;
}): Promise<ActionResult> {
  return runAction('Invitation sent', async () => {
    const body = parse(createInvitationRequest.extend({ projectId: id }), input);
    const result = await createInvitation(await getCurrentUser(), body);
    revalidatePath(MEMBERS_PATH, 'page');
    if (result.status === 'added') return `${body.email} already has an account and was added`;
  });
}

export async function updateMemberRole(input: {
  projectId: string;
  userId: string;
  role: string;
}): Promise<ActionResult> {
  return runAction('Role updated', async () => {
    const body = parse(z.object({ projectId: id, userId: id, role: projectRole }), input);
    await changeMemberRole(await getCurrentUser(), body.projectId, body.userId, body.role);
    revalidatePath(MEMBERS_PATH, 'page');
  });
}

export async function deleteMember(input: {
  projectId: string;
  userId: string;
}): Promise<ActionResult> {
  return runAction('Member removed', async () => {
    const body = parse(z.object({ projectId: id, userId: id }), input);
    await removeMember(await getCurrentUser(), body.projectId, body.userId);
    revalidatePath(MEMBERS_PATH, 'page');
  });
}

export async function resendMemberInvitation(invitationId: string): Promise<ActionResult> {
  return runAction('Invitation resent', async () => {
    await resendInvitation(await getCurrentUser(), parse(id, invitationId));
    revalidatePath(MEMBERS_PATH, 'page');
  });
}

export async function revokeMemberInvitation(invitationId: string): Promise<ActionResult> {
  return runAction('Invitation revoked', async () => {
    await revokeInvitation(await getCurrentUser(), parse(id, invitationId));
    revalidatePath(MEMBERS_PATH, 'page');
  });
}
