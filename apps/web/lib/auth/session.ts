import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createClient } from '../supabase/server';

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string | null;
  isPlatformAdmin: boolean;
}

/** The signed-in, enabled user, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name, is_platform_admin, disabled_at')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || profile.disabled_at) return null;
  return {
    id: user.id,
    email: profile.email,
    fullName: profile.full_name,
    isPlatformAdmin: profile.is_platform_admin,
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}
