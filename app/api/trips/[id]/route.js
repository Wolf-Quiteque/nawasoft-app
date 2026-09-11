import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { loadRun } from '@/lib/trip-run-detail';

export async function GET(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const supabase = createSupabaseAdminClient();

  try {
    const run = await loadRun(supabase, id);
    if (!run) return NextResponse.json({ error: 'Viagem não encontrada.' }, { status: 404 });
    return NextResponse.json({ run, primary_trip_id: id });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
