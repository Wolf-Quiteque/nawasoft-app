import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

export async function GET() {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = createSupabaseAdminClient();

  const [{ data: openStop, error: stopError }, { data: buses, error: busesError }] = await Promise.all([
    supabase
      .from('emergency_stops')
      .select('id, bus_ids, reason, activated_at, activated_by:profiles!emergency_stops_activated_by_fkey(first_name, last_name)')
      .is('resolved_at', null)
      .order('activated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('buses').select('id, license_plate, is_active').order('license_plate'),
  ]);

  if (stopError) return NextResponse.json({ error: stopError.message }, { status: 500 });
  if (busesError) return NextResponse.json({ error: busesError.message }, { status: 500 });

  const activeCount = (buses || []).filter((b) => b.is_active).length;

  return NextResponse.json({
    active: Boolean(openStop),
    stop: openStop || null,
    buses: buses || [],
    activeCount,
    totalCount: (buses || []).length,
  });
}

// POST { action: 'stop' | 'resume', reason? }
export async function POST(request) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.profile.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores podem usar a paragem de emergência.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const supabase = createSupabaseAdminClient();

  if (body.action === 'stop') {
    const { data: activeBuses, error: activeError } = await supabase
      .from('buses')
      .select('id')
      .eq('is_active', true);
    if (activeError) return NextResponse.json({ error: activeError.message }, { status: 500 });

    const busIds = (activeBuses || []).map((b) => b.id);
    if (!busIds.length) {
      return NextResponse.json({ error: 'Não há autocarros ativos para parar.' }, { status: 409 });
    }

    const { error: updateError } = await supabase.from('buses').update({ is_active: false }).in('id', busIds);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    const { data: stop, error: insertError } = await supabase
      .from('emergency_stops')
      .insert({ bus_ids: busIds, reason: body.reason || null, activated_by: auth.user.id })
      .select()
      .single();
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    return NextResponse.json({ success: true, stopped: busIds.length, stop });
  }

  if (body.action === 'resume') {
    const { data: openStop, error: stopError } = await supabase
      .from('emergency_stops')
      .select('id, bus_ids')
      .is('resolved_at', null)
      .order('activated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (stopError) return NextResponse.json({ error: stopError.message }, { status: 500 });
    if (!openStop) return NextResponse.json({ error: 'Não há nenhuma paragem de emergência ativa.' }, { status: 409 });

    const { error: updateError } = await supabase.from('buses').update({ is_active: true }).in('id', openStop.bus_ids);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    const { error: resolveError } = await supabase
      .from('emergency_stops')
      .update({ resolved_at: new Date().toISOString(), resolved_by: auth.user.id })
      .eq('id', openStop.id);
    if (resolveError) return NextResponse.json({ error: resolveError.message }, { status: 500 });

    return NextResponse.json({ success: true, resumed: openStop.bus_ids.length });
  }

  return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
}
