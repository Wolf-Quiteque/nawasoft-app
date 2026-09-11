import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { todayInLuanda } from '@/lib/format';
import { groupTripsIntoRuns, attachSoldCounts, pickCurrentRun, summarizeOrigins } from '@/lib/trip-runs';
import { sellableSeatCount } from '@/lib/seats';

const TRIP_SELECT = `
  id, route_id, bus_id, departure_time, arrival_time, status, sales_capacity_limit,
  route:routes(id, origin_city, origin_province, destination_city, destination_province),
  bus:buses(id, license_plate, make, model, capacity, is_active)
`;

export async function GET(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const supabase = createSupabaseAdminClient();

  const { data: bus, error: busError } = await supabase
    .from('buses')
    .select('id, license_plate, make, model, year, capacity, is_active')
    .eq('id', id)
    .maybeSingle();

  if (busError) return NextResponse.json({ error: busError.message }, { status: 500 });
  if (!bus) return NextResponse.json({ error: 'Autocarro não encontrado.' }, { status: 404 });

  const date = todayInLuanda();
  const dayStart = new Date(`${date}T00:00:00+01:00`).toISOString();

  const { data: trips, error: tripsError } = await supabase
    .from('trips')
    .select(TRIP_SELECT)
    .eq('bus_id', id)
    .gte('departure_time', dayStart)
    .in('status', ['scheduled', 'boarding'])
    .order('departure_time')
    .limit(40);

  if (tripsError) return NextResponse.json({ error: tripsError.message }, { status: 500 });

  const runs = groupTripsIntoRuns(trips || []);
  const tripIds = (trips || []).map((t) => t.id);

  const soldByTripId = new Map();
  if (tripIds.length) {
    const { data: tickets, error: ticketsError } = await supabase
      .from('tickets')
      .select('trip_id')
      .in('trip_id', tripIds)
      .in('status', ['active', 'pending', 'used']);
    if (ticketsError) return NextResponse.json({ error: ticketsError.message }, { status: 500 });
    for (const t of tickets || []) {
      soldByTripId.set(t.trip_id, (soldByTripId.get(t.trip_id) || 0) + 1);
    }
  }

  const runsWithCounts = attachSoldCounts(runs, soldByTripId).map((run) => ({
    departure_time: run.departure_time,
    arrival_time: run.arrival_time,
    status: run.status,
    sold: run.sold,
    capacity: run.capacity,
    remaining: run.remaining,
    origins: run.trips.map((t) => ({
      trip_id: t.id,
      departure_time: t.departure_time,
      origin_city: t.route?.origin_city,
      origin_province: t.route?.origin_province,
      destination_city: t.route?.destination_city,
      sold: t.sold,
    })),
    by_origin: summarizeOrigins(run.trips),
  }));

  const current = pickCurrentRun(runsWithCounts);
  const currentIndex = current ? runsWithCounts.indexOf(current) : -1;
  const upcoming = currentIndex >= 0 ? runsWithCounts.slice(currentIndex + 1) : [];
  const capacity = sellableSeatCount(bus.capacity);

  return NextResponse.json({
    bus,
    date,
    today: current || { departure_time: null, sold: 0, capacity, remaining: capacity, origins: [], by_origin: [] },
    upcoming,
  });
}
