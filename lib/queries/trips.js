import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { todayInLuanda } from '@/lib/format';
import { groupTripsIntoRuns, attachSoldCounts } from '@/lib/trip-runs';
import { luandaDayBounds, soldCountsByTrip } from '@/lib/queries/shared';

const TRIP_SELECT = `
  id, route_id, bus_id, departure_time, arrival_time, status, sales_capacity_limit,
  route:routes(id, origin_city, origin_province, destination_city, destination_province),
  bus:buses(id, license_plate, make, model, capacity, is_active),
  driver:profiles(id, first_name, last_name)
`;

export function isValidTripDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/** Departures for one day, grouped into runs. Throws on a database error. */
export async function loadTrips(dateInput) {
  const date = dateInput || todayInLuanda();
  const { dayStart, dayEnd } = luandaDayBounds(date);

  const supabase = createSupabaseAdminClient();
  const { data: trips, error: tripsError } = await supabase
    .from('trips')
    .select(TRIP_SELECT)
    .gte('departure_time', dayStart)
    .lte('departure_time', dayEnd)
    .in('status', ['scheduled', 'boarding'])
    .order('departure_time');

  if (tripsError) throw new Error(tripsError.message);

  const runs = groupTripsIntoRuns(trips || []);
  const soldByTripId = await soldCountsByTrip(supabase, (trips || []).map((t) => t.id));

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

  return { date, runs: runsWithCounts };
}
