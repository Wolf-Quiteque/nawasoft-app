import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { loadRun } from '@/lib/trip-run-detail';
import { routeKey, suggestDeparture } from '@/lib/trip-legs';
import { translateTripError, tripErrorStatus } from '@/lib/trip-errors';

// GET: routes that can be added to this journey as new boarding points,
// grouped by boarding city, with a suggested time and fare for each.
export async function GET(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const supabase = createSupabaseAdminClient({ actorUserId: auth.user.id, actorRole: auth.profile.role });

  try {
    const run = await loadRun(supabase, id);
    if (!run) return NextResponse.json({ error: 'Viagem não encontrada.' }, { status: 404 });

    const { data: routes, error: routesError } = await supabase
      .from('routes')
      .select('id, origin_city, destination_city, base_price_usd, estimated_duration_hours')
      .eq('company_id', run.company_id)
      .eq('is_active', true);
    if (routesError) throw routesError;

    const served = new Set(run.legs.map(routeKey));
    const candidates = (routes || []).filter((route) => !served.has(routeKey(route)));

    // The most recent trip on each route carries the fare and timing staff
    // actually use today, which beats the route's often-empty defaults.
    const latestByRoute = new Map();
    if (candidates.length) {
      const { data: recent, error: recentError } = await supabase
        .from('trips')
        .select('route_id, departure_time, arrival_time, price_usd')
        .in('route_id', candidates.map((route) => route.id))
        .neq('status', 'cancelled')
        .order('departure_time', { ascending: false })
        .limit(1000);
      if (recentError) throw recentError;
      for (const trip of recent || []) {
        if (!latestByRoute.has(trip.route_id)) latestByRoute.set(trip.route_id, trip);
      }
    }

    // Duplicate route rows exist for some city pairs: keep the one in service.
    const byPair = new Map();
    for (const route of candidates) {
      const latest = latestByRoute.get(route.id) || null;
      const score = latest ? new Date(latest.departure_time).getTime() : 0;
      const current = byPair.get(routeKey(route));
      if (!current || score > current.score) byPair.set(routeKey(route), { route, latest, score });
    }

    const earliestArrival = run.legs.reduce(
      (min, leg) => (!min || new Date(leg.arrival_time) < new Date(min) ? leg.arrival_time : min),
      null
    );
    const runMinutes = Math.round((new Date(run.arrival_time) - new Date(run.departure_time)) / 60000);

    const groups = new Map();
    for (const { route, latest, score } of byPair.values()) {
      const durationMinutes = latest
        ? Math.round((new Date(latest.arrival_time) - new Date(latest.departure_time)) / 60000)
        : route.estimated_duration_hours
          ? Math.round(Number(route.estimated_duration_hours) * 60)
          : runMinutes;
      const option = {
        route_id: route.id,
        destination_city: route.destination_city,
        suggested_price: Number(latest?.price_usd ?? route.base_price_usd ?? 0),
        duration_minutes: durationMinutes,
        suggested_departure: suggestDeparture({
          runDeparture: run.departure_time,
          runEarliestArrival: earliestArrival,
          usualDeparture: latest?.departure_time,
        }),
        score,
      };
      if (!groups.has(route.origin_city)) groups.set(route.origin_city, []);
      groups.get(route.origin_city).push(option);
    }

    const origins = [...groups.entries()]
      .map(([originCity, options]) => {
        const sorted = options.sort((a, b) => a.destination_city.localeCompare(b.destination_city));
        // The boarding time is shared by every destination from one city;
        // suggest the one from the route that ran most recently.
        const freshest = [...options].sort((a, b) => b.score - a.score)[0];
        return {
          origin_city: originCity,
          suggested_departure: freshest.suggested_departure,
          routes: sorted.map(({ score, ...rest }) => rest),
        };
      })
      .sort((a, b) => a.origin_city.localeCompare(b.origin_city));

    return NextResponse.json({
      run: {
        departure_time: run.departure_time,
        arrival_time: run.arrival_time,
        bus: run.bus,
        legs: run.legs.map((leg) => ({
          trip_id: leg.trip_id,
          origin_city: leg.origin_city,
          destination_city: leg.destination_city,
          departure_time: leg.departure_time,
          arrival_time: leg.arrival_time,
        })),
      },
      origins,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST { legs: [{ route_id, departure_time, arrival_time, price_usd }] }
export async function POST(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.legs) || body.legs.length === 0 || body.legs.length > 10) {
    return NextResponse.json({ error: 'Escolha entre 1 e 10 percursos para adicionar.' }, { status: 400 });
  }

  const legs = body.legs.map((leg) => ({
    route_id: leg.route_id,
    departure_time: leg.departure_time,
    arrival_time: leg.arrival_time,
    price_usd: Number(leg.price_usd),
  }));

  const supabase = createSupabaseAdminClient({ actorUserId: auth.user.id, actorRole: auth.profile.role });
  const { data, error } = await supabase.rpc('nawasoft_add_run_legs', { p_trip_id: id, p_legs: legs });
  if (error) return NextResponse.json({ error: translateTripError(error) }, { status: tripErrorStatus(error) });
  return NextResponse.json({ success: true, result: data });
}
