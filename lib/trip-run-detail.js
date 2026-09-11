import { sellableSeatCount } from '@/lib/seats';

const TRIP_SELECT = `
  id, route_id, bus_id, departure_time, arrival_time, status, sales_capacity_limit,
  route:routes(id, origin_city, origin_province, destination_city, destination_province, base_price_usd),
  bus:buses(id, license_plate, make, model, capacity, is_active),
  driver:profiles(id, first_name, last_name, phone_number)
`;

/** All sibling trip ids (same physical bus run) for a given trip id. */
export async function getRunTripIds(supabase, tripId) {
  const { data: siblings, error } = await supabase.rpc('get_overlapping_trip_ids', { p_trip_id: tripId });
  if (error) throw error;
  return siblings?.length ? siblings.map((s) => s.id) : [tripId];
}

/** Full run detail (bus, driver, per-leg sold counts, effective capacity). */
export async function loadRun(supabase, tripId) {
  const ids = await getRunTripIds(supabase, tripId);

  const { data: trips, error: tripsError } = await supabase
    .from('trips')
    .select(TRIP_SELECT)
    .in('id', ids)
    .order('departure_time');
  if (tripsError) throw tripsError;
  if (!trips?.length) return null;

  const { data: tickets, error: ticketsError } = await supabase
    .from('tickets')
    .select('trip_id')
    .in('trip_id', ids)
    .in('status', ['active', 'pending', 'used']);
  if (ticketsError) throw ticketsError;

  const soldByTripId = new Map();
  for (const t of tickets || []) soldByTripId.set(t.trip_id, (soldByTripId.get(t.trip_id) || 0) + 1);

  const bus = trips[0].bus;
  const busCapacity = sellableSeatCount(bus?.capacity);
  const limits = trips.map((t) => t.sales_capacity_limit).filter((v) => v != null);
  const capacity = limits.length ? Math.min(busCapacity, ...limits) : busCapacity;
  const sold = trips.reduce((sum, t) => sum + (soldByTripId.get(t.id) || 0), 0);

  return {
    trip_ids: ids,
    bus,
    driver: trips[0].driver,
    departure_time: trips[0].departure_time,
    arrival_time: trips[trips.length - 1].arrival_time,
    status: trips[0].status,
    capacity,
    sold,
    remaining: Math.max(capacity - sold, 0),
    legs: trips.map((t) => ({
      trip_id: t.id,
      route_id: t.route_id,
      origin_city: t.route?.origin_city,
      destination_city: t.route?.destination_city,
      base_price_usd: t.route?.base_price_usd,
      sales_capacity_limit: t.sales_capacity_limit,
      sold: soldByTripId.get(t.id) || 0,
    })),
  };
}
