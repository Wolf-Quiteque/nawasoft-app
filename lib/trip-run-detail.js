import { sellableSeatCount } from '@/lib/seats';

const TRIP_SELECT = `
  id, route_id, bus_id, driver_id, company_id, departure_time, arrival_time, status,
  seat_class, price_usd, is_campaign, sales_capacity_limit,
  route:routes(id, origin_city, origin_province, destination_city, destination_province, base_price_usd),
  bus:buses(id, license_plate, make, model, capacity, is_active),
  driver:profiles(id, first_name, last_name, phone_number)
`;

const LIVE_STATUSES = ['scheduled', 'boarding'];

/**
 * Ids of the trips that share seats with this one: same bus, overlapping
 * time window. The database RPC also returns cancelled trips whose window
 * overlaps (a cancelled noon departure, say), so those are dropped. The trip
 * that was asked about is always kept.
 */
export async function getRunTripIds(supabase, tripId) {
  const { data: siblings, error } = await supabase.rpc('get_overlapping_trip_ids', { p_trip_id: tripId });
  if (error) throw error;
  const ids = siblings?.length ? siblings.map((s) => s.id) : [tripId];

  const { data: live, error: liveError } = await supabase
    .from('trips')
    .select('id')
    .in('id', ids)
    .in('status', LIVE_STATUSES);
  if (liveError) throw liveError;

  const liveIds = new Set((live || []).map((t) => t.id));
  liveIds.add(tripId);
  return [...liveIds];
}

/** Seats taken and left on the whole bus run that a trip belongs to. */
export async function runOccupancy(supabase, tripId) {
  const ids = await getRunTripIds(supabase, tripId);

  const [{ data: trips, error: tripsError }, { data: tickets, error: ticketsError }] = await Promise.all([
    supabase.from('trips').select('id, sales_capacity_limit, bus:buses(capacity)').in('id', ids),
    supabase.from('tickets').select('seat_number').in('trip_id', ids).in('status', ['active', 'pending', 'used']),
  ]);
  if (tripsError) throw tripsError;
  if (ticketsError) throw ticketsError;

  const busCapacity = sellableSeatCount(trips?.[0]?.bus?.capacity);
  const limits = (trips || []).map((t) => t.sales_capacity_limit).filter((v) => v != null);
  const capacity = limits.length ? Math.min(busCapacity, ...limits) : busCapacity;
  const occupied = new Set((tickets || []).map((t) => Number(t.seat_number))).size;

  return { trip_ids: ids, capacity, occupied, remaining: Math.max(capacity - occupied, 0) };
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
  const latestArrival = trips.reduce(
    (latest, t) => (t.arrival_time && (!latest || new Date(t.arrival_time) > new Date(latest)) ? t.arrival_time : latest),
    null
  );

  return {
    trip_ids: ids,
    bus,
    driver: trips[0].driver,
    company_id: trips[0].company_id,
    driver_id: trips[0].driver_id,
    departure_time: trips[0].departure_time,
    arrival_time: latestArrival,
    status: trips[0].status,
    capacity,
    sold,
    remaining: Math.max(capacity - sold, 0),
    legs: trips.map((t) => ({
      trip_id: t.id,
      route_id: t.route_id,
      departure_time: t.departure_time,
      arrival_time: t.arrival_time,
      status: t.status,
      seat_class: t.seat_class,
      price_usd: t.price_usd,
      is_campaign: t.is_campaign,
      origin_city: t.route?.origin_city,
      destination_city: t.route?.destination_city,
      base_price_usd: t.route?.base_price_usd,
      sales_capacity_limit: t.sales_capacity_limit,
      sold: soldByTripId.get(t.id) || 0,
    })),
  };
}
