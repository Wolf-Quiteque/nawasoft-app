import { createClient } from '@supabase/supabase-js';

// Service-role client for privileged reads/writes (dashboards, refunds,
// reschedules, bulk bus toggles). Every route that uses this MUST call
// requireStaff() first — this client bypasses row level security entirely.
export function createSupabaseAdminClient({ actorUserId, actorRole } = {}) {
  const headers = {};
  if (actorUserId) headers['x-nawabus-actor-id'] = actorUserId;
  if (actorRole) headers['x-nawabus-actor-role'] = actorRole;

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers },
    }
  );
}
