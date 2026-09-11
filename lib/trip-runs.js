import { sellableSeatCount } from '@/lib/seats';

/**
 * A "run" is one physical journey of one bus. The coach picks passengers up
 * at several terminals, and every pickup/destination pair is its own `trips`
 * row. Example: the ZONG TONG leaves Kikolo at 18:00 and collects more
 * passengers at Gamek at 20:00 on the same drive to Benguela. Those rows
 * share every seat, so they must be counted as one bus load.
 *
 * Trips on the same bus join a run when their time windows overlap (a trip
 * departs before the run arrives). This is the same rule the database uses
 * in get_overlapping_trip_ids.
 */
export function groupTripsIntoRuns(trips) {
  const byBus = new Map();
  for (const trip of trips) {
    if (!byBus.has(trip.bus_id)) byBus.set(trip.bus_id, []);
    byBus.get(trip.bus_id).push(trip);
  }

  const runs = [];
  for (const busTrips of byBus.values()) {
    busTrips.sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time));
    let current = null;

    for (const trip of busTrips) {
      const depMs = new Date(trip.departure_time).getTime();
      const arrMs = new Date(trip.arrival_time || trip.departure_time).getTime();

      if (current && (depMs < current.arrivalMs || depMs === current.departureMs)) {
        current.run.trips.push(trip);
        if (arrMs > current.arrivalMs) {
          current.arrivalMs = arrMs;
          current.run.arrival_time = trip.arrival_time;
        }
        continue;
      }

      const run = {
        key: `${trip.bus_id}|${trip.departure_time}`,
        bus_id: trip.bus_id,
        bus: trip.bus,
        departure_time: trip.departure_time,
        arrival_time: trip.arrival_time,
        status: trip.status,
        trips: [trip],
      };
      runs.push(run);
      current = { run, departureMs: depMs, arrivalMs: arrMs };
    }
  }

  return runs.sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time));
}

/**
 * The run dispatch cares about right now: the first one that has not yet
 * arrived, or the last one of the list if they have all finished.
 */
export function pickCurrentRun(runs, now = Date.now()) {
  if (!runs.length) return null;
  const sorted = [...runs].sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time));
  return (
    sorted.find((run) => new Date(run.arrival_time || run.departure_time).getTime() > now) ||
    sorted[sorted.length - 1]
  );
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

/**
 * Passengers per pickup terminal for one run ("Kikolo 43, Gamek 9"), each
 * with its per-destination split. Expects trips that already carry `sold`.
 */
export function summarizeOrigins(trips) {
  const byCity = new Map();
  for (const trip of trips) {
    const city = trip.route?.origin_city || '—';
    if (!byCity.has(city)) {
      byCity.set(city, { origin_city: city, departure_time: trip.departure_time, sold: 0, destinations: [] });
    }
    const entry = byCity.get(city);
    entry.sold += trip.sold || 0;
    if (new Date(trip.departure_time) < new Date(entry.departure_time)) {
      entry.departure_time = trip.departure_time;
    }
    entry.destinations.push({
      trip_id: trip.id,
      destination_city: trip.route?.destination_city,
      sold: trip.sold || 0,
    });
  }
  return [...byCity.values()].sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time));
}
