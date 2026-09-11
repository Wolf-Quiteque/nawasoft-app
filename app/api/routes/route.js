import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { todayInLuanda } from '@/lib/format';

export async function GET() {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = createSupabaseAdminClient();
  const date = todayInLuanda();
  const dayStart = new Date(`${date}T00:00:00+01:00`).toISOString();
  const dayEnd = new Date(`${date}T23:59:59+01:00`).toISOString();

  const { data: routes, error: routesError } = await supabase
    .from('routes')
    .select('id, origin_city, origin_province, destination_city, destination_province, distance_km, base_price_usd, is_active')
    .order('origin_province')
    .order('origin_city');

  if (routesError) return NextResponse.json({ error: routesError.message }, { status: 500 });

  const { data: trips, error: tripsError } = await supabase
    .from('trips')
    .select('id, route_id')
    .gte('departure_time', dayStart)
    .lte('departure_time', dayEnd)
    .in('status', ['scheduled', 'boarding']);

  if (tripsError) return NextResponse.json({ error: tripsError.message }, { status: 500 });

  const tripIds = (trips || []).map((t) => t.id);
  const tripsByRoute = new Map();
  for (const t of trips || []) {
    if (!tripsByRoute.has(t.route_id)) tripsByRoute.set(t.route_id, []);
    tripsByRoute.get(t.route_id).push(t.id);
  }

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

  const provinceMap = new Map();
  for (const route of routes || []) {
    const ids = tripsByRoute.get(route.id) || [];
    const todaySold = ids.reduce((sum, id) => sum + (soldByTripId.get(id) || 0), 0);
    const entry = {
      ...route,
      today_trip_count: ids.length,
      today_sold: todaySold,
    };
    const province = route.origin_province || 'Outras';
    if (!provinceMap.has(province)) provinceMap.set(province, []);
    provinceMap.get(province).push(entry);
  }

  const provinces = [...provinceMap.entries()]
    .map(([province, list]) => ({ province, routes: list }))
    .sort((a, b) => a.province.localeCompare(b.province));

  return NextResponse.json({ date, provinces });
}
