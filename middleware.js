import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';

const PUBLIC_PATHS = ['/login'];

function isPublic(pathname) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// API routes each call requireStaff() themselves and return a clean JSON
// 401/403 — redirecting them to the HTML login page instead would break
// `await res.json()` on the client the moment a session expires mid-use.
function isApi(pathname) {
  return pathname.startsWith('/api/');
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  let response = NextResponse.next({ request });

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
  const weekMarker = request.cookies.get(SESSION_COOKIE)?.value;

  // The browser drops weekMarker on its own after 7 days. If Supabase still
  // thinks there's a user but our marker is gone, force a real sign-out
  // instead of silently riding Supabase's own refresh-token lifetime.
  const sessionExpired = Boolean(user) && !weekMarker;
  const signedIn = Boolean(user) && !sessionExpired;

  if (sessionExpired) {
    await supabase.auth.signOut();
  }

  if (isApi(pathname)) {
    return response;
  }

  if (!signedIn && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (signedIn && isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
