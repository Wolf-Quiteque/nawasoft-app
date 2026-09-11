import { getRunTripIds } from '@/lib/trip-run-detail';

export async function seatIsTaken(supabase, tripId, seatNumber, excludeTicketId) {
  let ids = [tripId];
  try {
    ids = await getRunTripIds(supabase, tripId);
  } catch {
    // fall back to checking just this trip
  }
  const { data: rows, error } = await supabase
    .from('tickets')
    .select('id')
    .in('trip_id', ids)
    .eq('seat_number', seatNumber)
    .in('status', ['active', 'used'])
    .neq('id', excludeTicketId);
  if (error) throw error;
  return Boolean(rows && rows.length > 0);
}

export async function recomputeSiblingsAvailableSeats(supabase, tripId, busId, departureTime) {
  const base = new Date(departureTime);
  base.setSeconds(0, 0);
  const minuteEnd = new Date(base);
  minuteEnd.setMinutes(base.getMinutes() + 1);

  const { data: siblings, error: sibError } = await supabase
    .from('trips')
    .select('id')
    .eq('bus_id', busId)
    .gte('departure_time', base.toISOString())
    .lt('departure_time', minuteEnd.toISOString());
  if (sibError) return;

  const ids = (siblings || []).map((s) => s.id);
  if (!ids.length) return;

  const { count } = await supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .in('trip_id', ids)
    .in('status', ['active', 'pending']);

  const { data: bus } = await supabase
    .from('trips')
    .select('bus:buses(capacity)')
    .eq('id', ids[0])
    .maybeSingle();
  const capacity = bus?.bus?.capacity || 0;

  await supabase
    .from('trips')
    .update({ available_seats: Math.max(capacity - 1 - (count || 0), 0) })
    .in('id', ids);
}
