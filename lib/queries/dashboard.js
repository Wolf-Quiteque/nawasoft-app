import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { todayInLuanda } from '@/lib/format';
import { groupTripsIntoRuns, attachSoldCounts, currentRunByBus, summarizeOrigins } from '@/lib/trip-runs';
import { sellableSeatCount } from '@/lib/seats';
import { luandaDayBounds, soldCountsByTrip } from '@/lib/queries/shared';

const TRIP_SELECT = `
  id, route_id, bus_id, departure_time, arrival_time, status, sales_capacity_limit,
  route:routes(id, origin_city, origin_province, destination_city, destination_province),
  bus:buses(id, license_plate, make, model, capacity, is_active)
`;

/** Today's fleet board. Throws on a database error. */
export async function loadDashboard() {
  const supabase = createSupabaseAdminClient();
  const date = todayInLuanda();
  const { dayStart, dayEnd } = luandaDayBounds(date);

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

  if (busesError) throw new Error(busesError.message);
  if (tripsError) throw new Error(tripsError.message);

  const runs = groupTripsIntoRuns(trips || []);
  const soldByTripId = await soldCountsByTrip(supabase, (trips || []).map((t) => t.id));

  // One run per bus: the one under way or next (tested in tests/trip-runs.test.js).
  const runsByBus = currentRunByBus(attachSoldCounts(runs, soldByTripId));

  const fleet = (buses || []).map((bus) => {
    const run = runsByBus.get(bus.id);
    if (run) {
      return {
        bus,
        run: {
          departure_time: run.departure_time,
          arrival_time: run.arrival_time,
          status: run.status,
          origin_province: run.trips.find((t) => t.route?.origin_province)?.route?.origin_province || null,
          origins: run.trips.map((t) => ({
            trip_id: t.id,
            route_id: t.route_id,
            departure_time: t.departure_time,
            origin_city: t.route?.origin_city,
            origin_province: t.route?.origin_province,
            destination_city: t.route?.destination_city,
            sold: t.sold,
          })),
          by_origin: summarizeOrigins(run.trips),
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

  return { date, fleet, totals, fleetSize: fleet.length };
}
