// The Supabase refresh token itself does not expire on a fixed schedule, so
// NAWASOFT enforces its own week-long session on top of it: this cookie is
// stamped at login with a 7-day Max-Age. Once the browser drops it, the
// middleware treats the visitor as signed out even if Supabase's own cookies
// are still technically valid, and clears them.
export const SESSION_COOKIE = 'nawasoft_session_started';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export const STAFF_ROLES = ['admin', 'agent'];
