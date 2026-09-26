import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { loadRun } from '@/lib/trip-run-detail';
import { canSettleAtCounter } from '@/lib/counter-permissions';

export async function GET(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const supabase = createSupabaseAdminClient({ actorUserId: auth.user.id, actorRole: auth.profile.role });

  try {
    const run = await loadRun(supabase, id);
    if (!run) return NextResponse.json({ error: 'Viagem não encontrada.' }, { status: 404 });
    return NextResponse.json({
      run,
      primary_trip_id: id,
      viewer: { can_settle_at_counter: canSettleAtCounter(auth.user.email) },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
