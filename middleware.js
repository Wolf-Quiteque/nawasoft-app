import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';

const PUBLIC_PATHS = ['/login'];

// The sign-in handshake is what *creates* the week marker, so the marker can
// never be present while these run. They must skip the expiry check below —
// otherwise the middleware signs out the brand-new session microseconds
// before the route handler tries to validate it, and login fails with
// "Auth session missing!".
const AUTH_HANDSHAKE_PATHS = ['/api/auth/session', '/api/auth/logout'];

function isPublic(pathname) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isAuthHandshake(pathname) {
  return AUTH_HANDSHAKE_PATHS.includes(pathname);
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

  // Let the sign-in/sign-out endpoints run untouched.
  if (isAuthHandshake(pathname)) {
    return response;
  }

  const { data: { user } } = await supabase.auth.getUser();
  const weekMarker = request.cookies.get(SESSION_COOKIE)?.value;

  // The browser drops weekMarker on its own after 7 days. If Supabase still
  // thinks there's a user but our marker is gone, end the session on this
  // device instead of silently riding Supabase's own refresh-token lifetime.
  const sessionExpired = Boolean(user) && !weekMarker;
  const signedIn = Boolean(user) && !sessionExpired;

  if (sessionExpired) {
    // scope: 'local' clears this device's cookies only. A global sign-out
    // would revoke the account's tokens everywhere — logging the same staff
    // member out of the Sunmi terminal and the agent app too.
    await supabase.auth.signOut({ scope: 'local' });
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
