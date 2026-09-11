import { sellableSeatCount } from '@/lib/seats';

/**
 * A "run" is one physical departure of one bus: several `trips` rows share a
 * bus_id and an exact departure_time when the same coach picks passengers up
 * at more than one terminal on the way (e.g. Kikolo + Gamek + Benguela, all
 * bound for Luanda). Dispatch thinks in runs, not in route rows, so every
 * NAWASOFT screen groups trips this way before showing them.
 */
export function groupTripsIntoRuns(trips) {
  const byKey = new Map();
  for (const trip of trips) {
    const key = `${trip.bus_id}|${trip.departure_time}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        bus_id: trip.bus_id,
        bus: trip.bus,
        departure_time: trip.departure_time,
        arrival_time: trip.arrival_time,
        status: trip.status,
        trips: [],
      });
    }
    byKey.get(key).trips.push(trip);
  }
  return [...byKey.values()].sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time));
}

/** Effective sellable capacity for a run: bus capacity minus the co-pilot seat, capped by any sales limit set on its trips. */
export function runEffectiveCapacity(run) {
  const busCapacity = sellableSeatCount(run.bus?.capacity);
  const limits = run.trips.map((t) => t.sales_capacity_limit).filter((v) => v != null);
  if (!limits.length) return busCapacity;
  return Math.min(busCapacity, ...limits);
}

export function attachSoldCounts(runs, soldByTripId) {
  return runs.map((run) => {
    const trips = run.trips.map((t) => ({ ...t, sold: soldByTripId.get(t.id) || 0 }));
    const sold = trips.reduce((sum, t) => sum + t.sold, 0);
    const capacity = runEffectiveCapacity(run);
    return { ...run, trips, sold, capacity, remaining: Math.max(capacity - sold, 0) };
  });
}
