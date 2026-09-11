// Regression tests for the middleware's session rules.
// Bug fixed 2026-09-11: the expiry check ran on the login endpoint itself,
// signed out the brand-new session, and every login failed with
// "Auth session missing!".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSession, isAuthHandshakePath, AUTH_HANDSHAKE_PATHS } from '../lib/auth-paths.js';

test('login handshake is never signed out, even before the week cookie exists', () => {
  assert.deepEqual(
    decideSession({ pathname: '/api/auth/session', hasUser: true, hasWeekMarker: false }),
    { signOut: false, redirectTo: null }
  );
});

test('logout endpoint also passes through untouched', () => {
  assert.deepEqual(
    decideSession({ pathname: '/api/auth/logout', hasUser: true, hasWeekMarker: false }),
    { signOut: false, redirectTo: null }
  );
});

test('both handshake endpoints are exempt', () => {
  assert.deepEqual([...AUTH_HANDSHAKE_PATHS].sort(), ['/api/auth/logout', '/api/auth/session']);
  assert.ok(isAuthHandshakePath('/api/auth/session'));
  assert.ok(!isAuthHandshakePath('/api/dashboard'));
});

test('a user whose 7-day week has ended is signed out and sent to login', () => {
  assert.deepEqual(
    decideSession({ pathname: '/tickets', hasUser: true, hasWeekMarker: false }),
    { signOut: true, redirectTo: '/login' }
  );
});

test('an expired session calling the API is signed out but gets JSON, not a redirect', () => {
  assert.deepEqual(
    decideSession({ pathname: '/api/dashboard', hasUser: true, hasWeekMarker: false }),
    { signOut: true, redirectTo: null }
  );
});

test('a visitor with no session is sent to login without a sign-out', () => {
  assert.deepEqual(
    decideSession({ pathname: '/', hasUser: false, hasWeekMarker: false }),
    { signOut: false, redirectTo: '/login' }
  );
});

test('a signed-in user opening the login page is sent home', () => {
  assert.deepEqual(
    decideSession({ pathname: '/login', hasUser: true, hasWeekMarker: true }),
    { signOut: false, redirectTo: '/' }
  );
});

test('a valid session on a normal page continues', () => {
  assert.deepEqual(
    decideSession({ pathname: '/trips', hasUser: true, hasWeekMarker: true }),
    { signOut: false, redirectTo: null }
  );
});
