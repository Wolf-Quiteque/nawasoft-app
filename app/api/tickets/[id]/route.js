import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { TICKET_SELECT, attachPassengers } from '@/lib/tickets';

export async function GET(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const supabase = createSupabaseAdminClient({ actorUserId: auth.user.id, actorRole: auth.profile.role });

  const { data: ticket, error } = await supabase.from('tickets').select(TICKET_SELECT).eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!ticket) return NextResponse.json({ error: 'Bilhete não encontrado.' }, { status: 404 });

  const [{ data: itineraryHistory, error: itineraryError }, { data: documentAccesses, error: accessError }] = await Promise.all([
    supabase
      .from('ticket_itinerary_revisions')
      .select(`
        id, event_type, source_trip_id, origin_city, origin_province,
        destination_city, destination_province, departure_time, arrival_time,
        bus_license_plate, bus_make, bus_model, seat_number, ticket_booking_time,
        is_historical_backfill, actor_user_id, actor_role, recorded_at
      `)
      .eq('ticket_id', id)
      .order('recorded_at', { ascending: true }),
    supabase
      .from('ticket_document_access_log')
      .select('id, outcome, details, requested_at')
      .contains('ticket_ids', [id])
      .order('requested_at', { ascending: false })
      .limit(20),
  ]);

  if (itineraryError) return NextResponse.json({ error: itineraryError.message }, { status: 500 });
  if (accessError) return NextResponse.json({ error: accessError.message }, { status: 500 });

  const [withPassenger] = await attachPassengers(supabase, [ticket]);
  return NextResponse.json({
    ticket: withPassenger,
    itinerary_history: itineraryHistory || [],
    document_accesses: documentAccesses || [],
  });
}

// PATCH { action: 'refund' } — releases the seat and marks the ticket refunded.
export async function PATCH(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  if (body.action !== 'refund') {
    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient({ actorUserId: auth.user.id, actorRole: auth.profile.role });
  const { data, error } = await supabase
    .from('tickets')
    .update({ status: 'refunded', payment_status: 'refunded' })
    .eq('id', id)
    .in('status', ['active', 'used'])
    .eq('payment_status', 'paid')
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: 'Bilhete não pode ser reembolsado (não pago, já reembolsado/cancelado, ou inativo).' },
      { status: 409 }
    );
  }

  return NextResponse.json({
    message: 'Bilhete reembolsado com sucesso. O assento foi libertado.',
    ticket: data[0],
  });
}
