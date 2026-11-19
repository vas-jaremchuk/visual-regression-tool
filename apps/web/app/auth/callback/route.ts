import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { safeNext } from '@/lib/auth/safe-next';
import { serverEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

/**
 * Completes magic-link and OAuth sign-in. Accepts the PKCE `code` (default flow) or a
 * `token_hash` + `type` pair (custom email templates). Disabled users are signed out again
 * immediately (REQ-AUTH-4).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  // APP_URL, not the request origin: behind proxies the origin can differ from the cookie host.
  const origin = serverEnv().APP_URL;
  const next = safeNext(searchParams.get('next'));
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const fail = (reason: string) => NextResponse.redirect(`${origin}/login?error=${reason}`);

  const supabase = await createClient();
  const { data, error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { data: { user: null }, error: new Error('missing code') };
  if (error || !data.user) return fail('link');

  const { data: profile } = await supabase
    .from('profiles')
    .select('disabled_at')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!profile || profile.disabled_at) {
    await supabase.auth.signOut({ scope: 'local' });
    return fail('disabled');
  }
  return NextResponse.redirect(`${origin}${next}`);
}
