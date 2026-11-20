'use server';

import { createInvitationRequest, id } from '@vrt/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/session';
import { runAction, type ActionResult } from '@/lib/members/action-result';
import { RequestError } from '@/lib/members/errors';
import {
  createInvitation,
  resendInvitation,
  revokeInvitation,
  setPlatformAdmin,
  setUserDisabled,
} from '@/lib/members/service';

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new RequestError(400, 'validation', result.error.issues[0]?.message ?? 'Invalid input');
  }
  return result.data;
}

const USERS_PATH = '/admin/users';

export async function invitePlatformUser(email: string): Promise<ActionResult> {
  return runAction('Invitation sent', async () => {
    const body = parse(createInvitationRequest, { email, projectId: null });
    await createInvitation(await getCurrentUser(), body);
    revalidatePath(USERS_PATH);
  });
}

export async function setDisabled(userId: string, disabled: boolean): Promise<ActionResult> {
  return runAction(disabled ? 'User disabled' : 'User enabled', async () => {
    await setUserDisabled(await getCurrentUser(), parse(id, userId), parse(z.boolean(), disabled));
    revalidatePath(USERS_PATH);
  });
}

export async function setAdmin(userId: string, admin: boolean): Promise<ActionResult> {
  return runAction(admin ? 'Promoted to platform admin' : 'Platform admin removed', async () => {
    await setPlatformAdmin(await getCurrentUser(), parse(id, userId), parse(z.boolean(), admin));
    revalidatePath(USERS_PATH);
  });
}

export async function resendPlatformInvitation(invitationId: string): Promise<ActionResult> {
  return runAction('Invitation resent', async () => {
    await resendInvitation(await getCurrentUser(), parse(id, invitationId));
    revalidatePath(USERS_PATH);
  });
}

export async function revokePlatformInvitation(invitationId: string): Promise<ActionResult> {
  return runAction('Invitation revoked', async () => {
    await revokeInvitation(await getCurrentUser(), parse(id, invitationId));
    revalidatePath(USERS_PATH);
  });
}
