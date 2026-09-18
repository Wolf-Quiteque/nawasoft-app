import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { loadRun } from '@/lib/trip-run-detail';
import { groupTripsIntoRuns, attachSoldCounts } from '@/lib/trip-runs';
import { luandaDayBounds, soldCountsByTrip } from '@/lib/queries/shared';
import { missingRoutes } from '@/lib/trip-legs';
import { shareOneSeatPool } from '@/lib/trip-schedule';
import { translateTripError, tripErrorStatus } from '@/lib/trip-errors';

const TRIP_SELECT = `
  id, route_id, bus_id, departure_time, arrival_time, status, sales_capacity_limit,
  route:routes(origin_city, origin_province, destination_city),
  bus:buses(id, license_plate, make, model, capacity, company_id)
`;

function localDate(iso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Luanda', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

// GET: other buses running the same day that this journey's passengers could
// join, including buses that don't serve every route yet (those routes get
// added with this journey's times when joining).
export async function GET(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const supabase = createSupabaseAdminClient({ actorUserId: auth.user.id, actorRole: auth.profile.role });

  try {
    const run = await loadRun(supabase, id);
    if (!run) return NextResponse.json({ error: 'Viagem não encontrada.' }, { status: 404 });

    const { dayStart, dayEnd } = luandaDayBounds(localDate(run.departure_time));
    const { data: trips, error: tripsError } = await supabase
      .from('trips')
      .select(TRIP_SELECT)
      .gte('departure_time', dayStart)
      .lte('departure_time', dayEnd)
      .in('status', ['scheduled', 'boarding'])
      .order('departure_time');
    if (tripsError) throw tripsError;

    const sold = await soldCountsByTrip(supabase, (trips || []).map((trip) => trip.id));
    const runs = attachSoldCounts(groupTripsIntoRuns(trips || []), sold);

    // Only buses leaving from the same province can take these passengers:
    // Kikolo and Gamek (both Luanda) can join each other, but a bus leaving
    // Benguela that evening is at the other end of the corridor.
    const provinceOf = (trip) => String(trip.route?.origin_province || '').trim().toLowerCase();
    const sourceIds = new Set(run.trip_ids || []);
    const sourceProvinces = new Set((trips || []).filter((trip) => sourceIds.has(trip.id)).map(provinceOf).filter(Boolean));
    const sameArea = (candidate) =>
      !sourceProvinces.size || candidate.trips.some((trip) => sourceProvinces.has(provinceOf(trip)));

    const candidates = runs
      .filter((candidate) => candidate.bus_id !== run.bus?.id && candidate.bus?.company_id === run.company_id)
      .filter(sameArea)
      .map((candidate) => {
        const targetLegs = candidate.trips.map((trip) => ({
          origin_city: trip.route?.origin_city,
          destination_city: trip.route?.destination_city,
          departure_time: trip.departure_time,
          arrival_time: trip.arrival_time,
        }));
        const missing = missingRoutes(run.legs, targetLegs);
        const remaining = candidate.capacity - candidate.sold - run.sold;
        return {
          trip_id: candidate.trips[0].id,
          bus: candidate.bus,
          departure_time: candidate.departure_time,
          sold: candidate.sold,
          capacity: candidate.capacity,
          remaining_after_merge: remaining,
          routes: [...new Set(targetLegs.map((leg) => `${leg.origin_city} → ${leg.destination_city}`))],
          missing_routes: missing.map((leg) => ({
            origin_city: leg.origin_city,
            destination_city: leg.destination_city,
            departure_time: leg.departure_time,
          })),
          fits: remaining >= 0,
          times_ok: shareOneSeatPool([...targetLegs, ...missing]),
        };
      })
      .sort((a, b) =>
        Number(b.fits && b.times_ok) - Number(a.fits && a.times_ok)
        || b.remaining_after_merge - a.remaining_after_merge);

    return NextResponse.json({
      run: { bus: run.bus, sold: run.sold, departure_time: run.departure_time },
      candidates,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST { target_trip_id } — adds any missing routes to the target bus, then
// moves every passenger across, in one database transaction.
export async function POST(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (!body.target_trip_id) {
    return NextResponse.json({ error: 'Selecione o autocarro de destino.' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient({ actorUserId: auth.user.id, actorRole: auth.profile.role });
  const { data, error } = await supabase.rpc('nawasoft_merge_into_run', {
    p_source_trip_id: id,
    p_target_trip_id: body.target_trip_id,
  });
  if (error) return NextResponse.json({ error: translateTripError(error) }, { status: tripErrorStatus(error) });
  return NextResponse.json({ success: true, result: data });
}
