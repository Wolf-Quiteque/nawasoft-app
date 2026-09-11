import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { todayInLuanda } from '@/lib/format';
import { groupTripsIntoRuns, attachSoldCounts } from '@/lib/trip-runs';

const TRIP_SELECT = `
  id, route_id, bus_id, departure_time, arrival_time, status, sales_capacity_limit,
  route:routes(id, origin_city, origin_province, destination_city, destination_province),
  bus:buses(id, license_plate, make, model, capacity, is_active),
  driver:profiles(id, first_name, last_name)
`;

// GET /api/trips?date=YYYY-MM-DD (defaults to today in Africa/Luanda)
export async function GET(request) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || todayInLuanda();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Data inválida.' }, { status: 400 });
  }

  const dayStart = new Date(`${date}T00:00:00+01:00`).toISOString();
  const dayEnd = new Date(`${date}T23:59:59+01:00`).toISOString();

  const supabase = createSupabaseAdminClient();
  const { data: trips, error: tripsError } = await supabase
    .from('trips')
    .select(TRIP_SELECT)
    .gte('departure_time', dayStart)
    .lte('departure_time', dayEnd)
    .in('status', ['scheduled', 'boarding'])
    .order('departure_time');

  if (tripsError) return NextResponse.json({ error: tripsError.message }, { status: 500 });

  const runs = groupTripsIntoRuns(trips || []);
  const tripIds = (trips || []).map((t) => t.id);

  let soldByTripId = new Map();
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
    key: run.key,
    bus: run.bus,
    departure_time: run.departure_time,
    arrival_time: run.arrival_time,
    status: run.status,
    driver: run.trips[0]?.driver || null,
    sold: run.sold,
    capacity: run.capacity,
    remaining: run.remaining,
    legs: run.trips.map((t) => ({
      trip_id: t.id,
      origin_city: t.route?.origin_city,
      destination_city: t.route?.destination_city,
      sold: t.sold,
      sales_capacity_limit: t.sales_capacity_limit,
    })),
  }));

  return NextResponse.json({ date, runs: runsWithCounts });
}
