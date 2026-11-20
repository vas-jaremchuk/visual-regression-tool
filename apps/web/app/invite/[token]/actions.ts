'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env';
import { findInvitation } from '@/lib/invitations/lookup';
import { describeError } from '@/lib/members/errors';
import { acceptInvitation } from '@/lib/members/service';
import { createClient } from '@/lib/supabase/server';

export interface InviteActionState {
  status: 'idle' | 'sent' | 'error';
  message?: string;
}

const tokenInput = z.string().min(1).max(200);

/**
 * Sends a sign-in link to the invited email. Unlike /login this may create the account; the
 * before-user-created hook still checks the invitation (REQ-AUTH-1).
 */
export async function sendInviteSignInLink(
  _previous: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  const token = tokenInput.safeParse(formData.get('token'));
  if (!token.success) return { status: 'error', message: 'Invalid invitation link' };
  const invitation = await findInvitation(token.data);
  if (!invitation || invitation.state !== 'pending') {
    return { status: 'error', message: 'This invitation can no longer be used.' };
  }
  const next = `/invite/${encodeURIComponent(token.data)}`;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: invitation.email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${serverEnv().APP_URL}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { status: 'error', message: error.message };
  return { status: 'sent' };
}

export async function acceptInvitationAction(
  _previous: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  const token = tokenInput.safeParse(formData.get('token'));
  const user = await getCurrentUser();
  if (!token.success || !user) return { status: 'error', message: 'Sign in to accept.' };
  let result;
  try {
    result = await acceptInvitation(user, token.data);
  } catch (error) {
    return { status: 'error', message: describeError(error).message };
  }
  if (result.status !== 'accepted') {
    redirect(`/invite/${encodeURIComponent(token.data)}`);
  }
  redirect(result.projectSlug ? `/p/${result.projectSlug}` : '/');
}

export async function signOutFromInvite(formData: FormData) {
  const token = tokenInput.safeParse(formData.get('token'));
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect(token.success ? `/invite/${encodeURIComponent(token.data)}` : '/login');
}
