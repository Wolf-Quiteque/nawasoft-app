// Query helpers shared by the API routes and the server components that now
// render the same data directly. Keeping the loading logic here means a screen
// and its /api/ endpoint can never drift apart.

/** Start/end of a YYYY-MM-DD day in Africa/Luanda, as ISO instants. */
export function luandaDayBounds(date) {
  return {
    dayStart: new Date(`${date}T00:00:00+01:00`).toISOString(),
    dayEnd: new Date(`${date}T23:59:59+01:00`).toISOString(),
  };
}

/** Tickets sold per trip id, counting only seats that occupy capacity. */
export async function soldCountsByTrip(supabase, tripIds) {
  const counts = new Map();
  if (!tripIds.length) return counts;

  const { data, error } = await supabase
    .from('tickets')
    .select('trip_id')
    .in('trip_id', tripIds)
    .in('status', ['active', 'pending', 'used']);

  if (error) throw new Error(error.message);
  for (const t of data || []) counts.set(t.trip_id, (counts.get(t.trip_id) || 0) + 1);
  return counts;
}
