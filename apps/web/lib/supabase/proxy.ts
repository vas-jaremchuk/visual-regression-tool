import { createServerClient } from '@supabase/ssr';
import type { Database } from '@vrt/db';
import { NextResponse, type NextRequest } from 'next/server';
import { forbiddenHtml } from '../auth/forbidden-response';
import { isPublicPath } from '../auth/public-paths';
import { adminSettingsSlug } from '../auth/settings-paths';
import { publicEnv } from '../public-env';

/**
 * Refreshes the Supabase session cookies on every request and gates private routes
 * (REQ-AUTH-3). Disabled users are signed out on their next request (REQ-AUTH-4).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = publicEnv();
  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { pathname, search } = request.nextUrl;

  const redirectTo = (path: string, params: Record<string, string>) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = new URLSearchParams(params).toString();
    const redirect = NextResponse.redirect(url);
    // Carry over refreshed or cleared auth cookies.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('disabled_at')
      .eq('id', user.id)
      .maybeSingle();
    if (profile?.disabled_at) {
      await supabase.auth.signOut({ scope: 'local' });
      return redirectTo('/login', { error: 'disabled' });
    }
    if (pathname === '/login') return redirectTo('/', {});
    // Settings are for project admins (04 §3). Checked here because a page that has started
    // streaming cannot change its status any more; the pages check again with assertCan.
    const settingsSlug = adminSettingsSlug(pathname);
    if (settingsSlug) {
      const { data: project } = await supabase
        .from('projects_public')
        .select('id')
        .eq('slug', settingsSlug)
        .maybeSingle();
      if (project?.id) {
        const { data: isAdmin } = await supabase.rpc('can_admin', { p_project_id: project.id });
        if (!isAdmin) {
          const forbidden = new NextResponse(forbiddenHtml(), {
            status: 403,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
          for (const cookie of response.cookies.getAll()) forbidden.cookies.set(cookie);
          return forbidden;
        }
      }
    }
    return response;
  }

  if (!isPublicPath(pathname)) return redirectTo('/login', { next: pathname + search });
  return response;
}
