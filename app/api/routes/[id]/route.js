import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { todayInLuanda } from '@/lib/format';
import { runOccupancy } from '@/lib/trip-run-detail';

export async function GET(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const supabase = createSupabaseAdminClient();

  const { data: route, error: routeError } = await supabase
    .from('routes')
    .select('id, origin_city, origin_province, destination_city, destination_province, distance_km, estimated_duration_hours, base_price_usd, is_active, typical_departure_times')
    .eq('id', id)
    .maybeSingle();

  if (routeError) return NextResponse.json({ error: routeError.message }, { status: 500 });
  if (!route) return NextResponse.json({ error: 'Rota não encontrada.' }, { status: 404 });

  const date = todayInLuanda();
  const dayStart = new Date(`${date}T00:00:00+01:00`).toISOString();
  const dayEnd = new Date(`${date}T23:59:59+01:00`).toISOString();

  const { data: trips, error: tripsError } = await supabase
    .from('trips')
    .select(`
      id, departure_time, arrival_time, status, sales_capacity_limit,
      bus:buses(id, license_plate, capacity)
    `)
    .eq('route_id', id)
    .gte('departure_time', dayStart)
    .lte('departure_time', dayEnd)
    .in('status', ['scheduled', 'boarding'])
    .order('departure_time');

  if (tripsError) return NextResponse.json({ error: tripsError.message }, { status: 500 });

  try {
    const tripIds = (trips || []).map((t) => t.id);
    const soldByTripId = new Map();
    if (tripIds.length) {
      const { data: tickets, error: ticketsError } = await supabase
        .from('tickets')
        .select('trip_id')
        .in('trip_id', tripIds)
        .in('status', ['active', 'pending', 'used']);
      if (ticketsError) throw ticketsError;
      for (const t of tickets || []) {
        soldByTripId.set(t.trip_id, (soldByTripId.get(t.trip_id) || 0) + 1);
      }
    }

    // Seats are shared with passengers picked up at other terminals on the
    // same bus, so free seats come from the whole run, not this route alone.
    const occupancies = await Promise.all((trips || []).map((t) => runOccupancy(supabase, t.id)));

    const departures = (trips || []).map((t, i) => ({
      trip_id: t.id,
      departure_time: t.departure_time,
      arrival_time: t.arrival_time,
      status: t.status,
      bus: t.bus,
      leg_sold: soldByTripId.get(t.id) || 0,
      sold: occupancies[i].occupied,
      capacity: occupancies[i].capacity,
      remaining: occupancies[i].remaining,
    }));

    return NextResponse.json({ date, route, departures });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
