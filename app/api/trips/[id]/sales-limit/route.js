import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

// PATCH { limit: number | null } — applies to every leg of the physical run
// via the set_trip_sales_capacity_limit RPC (service-role only).
export async function PATCH(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.profile.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores podem alterar o limite de vendas.' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const rawLimit = body?.limit;
  const limit = rawLimit === null || rawLimit === '' || rawLimit === undefined ? null : Number(rawLimit);

  if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
    return NextResponse.json({ error: 'O limite deve ser um número inteiro igual ou superior a zero.' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient({ actorUserId: auth.user.id, actorRole: auth.profile.role });
  const { data, error } = await supabase.rpc('set_trip_sales_capacity_limit', {
    p_trip_id: id,
    p_limit: limit,
  });

  if (error) {
    const status = ['22023', 'P0002'].includes(error.code) ? 400 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ success: true, result: data });
}
