import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { getRunTripIds } from '@/lib/trip-run-detail';
import { COPILOT_SEAT_NUMBER, sellableSeatCount } from '@/lib/seats';

export async function GET(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const supabase = createSupabaseAdminClient();

  try {
    const ids = await getRunTripIds(supabase, id);

    const { data: trips, error: tripsError } = await supabase
      .from('trips')
      .select('id, bus:buses(capacity), route:routes(origin_city, destination_city)')
      .in('id', ids);
    if (tripsError) throw tripsError;
    if (!trips?.length) return NextResponse.json({ error: 'Viagem não encontrada.' }, { status: 404 });

    const capacity = sellableSeatCount(trips[0].bus?.capacity);
    const legByTripId = new Map(trips.map((t) => [t.id, `${t.route?.origin_city} → ${t.route?.destination_city}`]));

    const { data: tickets, error: ticketsError } = await supabase
      .from('tickets')
      .select('id, trip_id, seat_number, status, ticket_number, passenger_id, price_paid_usd, payment_status')
      .in('trip_id', ids)
      .in('status', ['active', 'pending', 'used']);
    if (ticketsError) throw ticketsError;

    const passengerIds = [...new Set((tickets || []).map((t) => t.passenger_id).filter(Boolean))];
    let passengerMap = new Map();
    if (passengerIds.length) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, phone_number')
        .in('id', passengerIds);
      passengerMap = new Map((profiles || []).map((p) => [p.id, p]));
    }

    const ticketBySeat = new Map();
    for (const t of tickets || []) ticketBySeat.set(Number(t.seat_number), t);

    const seats = [];
    for (let n = 1; n <= trips[0].bus?.capacity; n += 1) {
      if (n === COPILOT_SEAT_NUMBER) {
        seats.push({ number: n, state: 'copilot' });
        continue;
      }
      const ticket = ticketBySeat.get(n);
      if (!ticket) {
        seats.push({ number: n, state: 'available' });
        continue;
      }
      const passenger = passengerMap.get(ticket.passenger_id);
      seats.push({
        number: n,
        state: 'occupied',
        ticket: {
          id: ticket.id,
          ticket_number: ticket.ticket_number,
          status: ticket.status,
          payment_status: ticket.payment_status,
          price_paid_usd: ticket.price_paid_usd,
          leg: legByTripId.get(ticket.trip_id),
          passenger_name: passenger ? `${passenger.first_name || ''} ${passenger.last_name || ''}`.trim() : null,
          passenger_phone: passenger?.phone_number || null,
        },
      });
    }

    return NextResponse.json({ capacity, sold: tickets?.length || 0, seats });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
