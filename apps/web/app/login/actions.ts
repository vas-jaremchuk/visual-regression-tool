'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { safeNext } from '@/lib/auth/safe-next';
import { serverEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export interface MagicLinkState {
  status: 'idle' | 'sent' | 'error';
  message?: string;
  /** Echoed back so the field keeps its value after an error. */
  email?: string;
}

const magicLinkInput = z.object({
  email: z.email({ error: 'Enter a valid email address' }).trim().toLowerCase(),
  next: z.string().optional(),
});

// Supabase answers these for emails without an account. They are reported as "sent" so the
// form does not reveal which addresses exist (accounts are invite-only, 04 §1).
const UNKNOWN_USER_CODES = new Set(['otp_disabled', 'signup_disabled', 'user_not_found']);

function callbackUrl(next: string) {
  return `${serverEnv().APP_URL}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
}

export async function sendMagicLink(
  _previous: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const parsed = magicLinkInput.safeParse({
    email: formData.get('email'),
    next: formData.get('next') ?? undefined,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
      email: String(formData.get('email') ?? ''),
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: false, emailRedirectTo: callbackUrl(parsed.data.next ?? '/') },
  });
  if (error && !UNKNOWN_USER_CODES.has(error.code ?? '')) {
    return { status: 'error', message: error.message, email: parsed.data.email };
  }
  return { status: 'sent' };
}

export async function signInWithGoogle(formData: FormData) {
  if (!serverEnv().GOOGLE_AUTH_ENABLED) redirect('/login');
  const next = typeof formData.get('next') === 'string' ? String(formData.get('next')) : '/';
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: callbackUrl(next) },
  });
  if (error || !data.url) redirect('/login?error=oauth');
  redirect(data.url);
}
