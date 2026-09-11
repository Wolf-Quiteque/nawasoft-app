import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';
import { decideSession, isAuthHandshakePath } from '@/lib/auth-paths';

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  let response = NextResponse.next({ request });

  // Sign-in and sign-out manage the session themselves. Leave them untouched
  // (see lib/auth-paths.js and tests/auth-paths.test.js for why).
  if (isAuthHandshakePath(pathname)) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const decision = decideSession({
    pathname,
    hasUser: Boolean(user),
    hasWeekMarker: Boolean(request.cookies.get(SESSION_COOKIE)?.value),
  });

  if (decision.signOut) {
    // scope 'local' ends the session on this device only. A global sign-out
    // would revoke the account everywhere, including the Sunmi terminal.
    await supabase.auth.signOut({ scope: 'local' });
  }

  if (decision.redirectTo) {
    const url = request.nextUrl.clone();
    url.pathname = decision.redirectTo;
    url.search = '';
    if (decision.redirectTo === '/login') url.searchParams.set('next', pathname);
    const redirect = NextResponse.redirect(url);
    // Carry over any cookie changes (e.g. the cleared session) to the redirect.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
