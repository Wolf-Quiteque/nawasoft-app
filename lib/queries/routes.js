import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { todayInLuanda } from '@/lib/format';
import { luandaDayBounds, soldCountsByTrip } from '@/lib/queries/shared';

/** Routes grouped by origin province, with today's activity. Throws on error. */
export async function loadRoutes() {
  const supabase = createSupabaseAdminClient();
  const date = todayInLuanda();
  const { dayStart, dayEnd } = luandaDayBounds(date);

  // Independent of each other, so pay for one round trip rather than two.
  const [{ data: routes, error: routesError }, { data: trips, error: tripsError }] = await Promise.all([
    supabase
      .from('routes')
      .select('id, origin_city, origin_province, destination_city, destination_province, distance_km, base_price_usd, is_active')
      .order('origin_province')
      .order('origin_city'),
    supabase
      .from('trips')
      .select('id, route_id')
      .gte('departure_time', dayStart)
      .lte('departure_time', dayEnd)
      .in('status', ['scheduled', 'boarding']),
  ]);

  if (routesError) throw new Error(routesError.message);
  if (tripsError) throw new Error(tripsError.message);

  const tripsByRoute = new Map();
  for (const t of trips || []) {
    if (!tripsByRoute.has(t.route_id)) tripsByRoute.set(t.route_id, []);
    tripsByRoute.get(t.route_id).push(t.id);
  }

  const soldByTripId = await soldCountsByTrip(supabase, (trips || []).map((t) => t.id));

  const provinceMap = new Map();
  for (const route of routes || []) {
    const ids = tripsByRoute.get(route.id) || [];
    const entry = {
      ...route,
      today_trip_count: ids.length,
      today_sold: ids.reduce((sum, id) => sum + (soldByTripId.get(id) || 0), 0),
    };
    const province = route.origin_province || 'Outras';
    if (!provinceMap.has(province)) provinceMap.set(province, []);
    provinceMap.get(province).push(entry);
  }

  const provinces = [...provinceMap.entries()]
    .map(([province, list]) => ({ province, routes: list }))
    .sort((a, b) => a.province.localeCompare(b.province));

  return { date, provinces };
}
