import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { STAFF_ROLES } from '@/lib/session';

/**
 * Confirms the request carries a signed-in admin/agent session and returns
 * their id, role and display name. Every API route that touches passenger
 * or fleet data calls this first.
 */
export async function requireStaff() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { error: 'Sessão expirada. Entre novamente.', status: 401 };
  }

  const admin = createSupabaseAdminClient();
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, role, first_name, last_name, company_id')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError || !profile || !STAFF_ROLES.includes(profile.role)) {
    return { error: 'Esta conta não tem acesso ao NAWASOFT.', status: 403 };
  }

  return { user, profile };
}
