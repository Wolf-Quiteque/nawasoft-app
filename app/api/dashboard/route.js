import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { todayInLuanda } from '@/lib/format';
import { groupTripsIntoRuns, attachSoldCounts } from '@/lib/trip-runs';
import { sellableSeatCount } from '@/lib/seats';

const TRIP_SELECT = `
  id, route_id, bus_id, departure_time, arrival_time, status, sales_capacity_limit,
  route:routes(id, origin_city, origin_province, destination_city, destination_province),
  bus:buses(id, license_plate, make, model, capacity, is_active)
`;

export async function GET() {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = createSupabaseAdminClient();
  const date = todayInLuanda();
  const dayStart = new Date(`${date}T00:00:00+01:00`).toISOString();
  const dayEnd = new Date(`${date}T23:59:59+01:00`).toISOString();

  const [{ data: buses, error: busesError }, { data: trips, error: tripsError }] = await Promise.all([
    supabase
      .from('buses')
      .select('id, license_plate, make, model, capacity, is_active')
      .eq('is_active', true)
      .order('license_plate'),
    supabase
      .from('trips')
      .select(TRIP_SELECT)
      .gte('departure_time', dayStart)
      .lte('departure_time', dayEnd)
      .in('status', ['scheduled', 'boarding'])
      .order('departure_time'),
  ]);

  if (busesError) return NextResponse.json({ error: busesError.message }, { status: 500 });
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

  const runsWithCounts = attachSoldCounts(runs, soldByTripId);
  const runsByBus = new Map(runsWithCounts.map((r) => [r.bus_id, r]));

  const fleet = (buses || []).map((bus) => {
    const run = runsByBus.get(bus.id);
    if (run) {
      return {
        bus,
        run: {
          departure_time: run.departure_time,
          arrival_time: run.arrival_time,
          status: run.status,
          origins: run.trips.map((t) => ({
            trip_id: t.id,
            route_id: t.route_id,
            origin_city: t.route?.origin_city,
            origin_province: t.route?.origin_province,
            destination_city: t.route?.destination_city,
            sold: t.sold,
          })),
        },
        sold: run.sold,
        capacity: run.capacity,
        remaining: run.remaining,
      };
    }
    const capacity = sellableSeatCount(bus.capacity);
    return { bus, run: null, sold: 0, capacity, remaining: capacity };
  });

  fleet.sort((a, b) => {
    if (a.run && b.run) return new Date(a.run.departure_time) - new Date(b.run.departure_time);
    if (a.run) return -1;
    if (b.run) return 1;
    return a.bus.license_plate.localeCompare(b.bus.license_plate);
  });

  const totals = fleet.reduce(
    (acc, f) => {
      acc.sold += f.sold;
      acc.capacity += f.capacity;
      if (f.run) acc.busesInService += 1;
      return acc;
    },
    { sold: 0, capacity: 0, busesInService: 0 }
  );

  return NextResponse.json({ date, fleet, totals, fleetSize: fleet.length });
}
