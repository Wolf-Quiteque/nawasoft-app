// Pure helpers for adding boarding points to a journey and for joining two
// journeys. No framework imports, so `node --test` can load this directly.
// The database functions re-check all of this; these exist so staff see the
// problem on screen before they tap confirm.
import { shareOneSeatPool } from './trip-schedule.js';

const LUANDA_OFFSET_MS = 60 * 60 * 1000; // Africa/Luanda is UTC+1, no DST

export function routeKey(leg) {
  return `${String(leg.origin_city || '').trim().toLowerCase()}→${String(leg.destination_city || '').trim().toLowerCase()}`;
}

/** Routes of the source journey that the target journey does not serve yet, once each. */
export function missingRoutes(sourceLegs, targetLegs) {
  const served = new Set(targetLegs.map(routeKey));
  const seen = new Set();
  return sourceLegs.filter((leg) => {
    const key = routeKey(leg);
    if (served.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Returns a message explaining why these new legs cannot be added, or null. */
export function validateNewLegs(existingLegs, newLegs) {
  if (!newLegs.length) return 'Escolha pelo menos um destino.';
  for (const leg of newLegs) {
    if (!leg.departure_time || !leg.arrival_time) return 'Indique a partida e a chegada de cada percurso.';
    if (new Date(leg.arrival_time) <= new Date(leg.departure_time)) return 'A chegada tem de ser depois da partida.';
    if (!(Number(leg.price_usd) > 0)) return 'Indique um preço válido para cada percurso.';
  }
  const served = new Set(existingLegs.map(routeKey));
  const duplicate = newLegs.find((leg) => served.has(routeKey(leg)));
  if (duplicate) return `Este autocarro já faz ${duplicate.origin_city} → ${duplicate.destination_city}.`;
  if (!shareOneSeatPool([...existingLegs, ...newLegs])) {
    return 'Os horários têm de se sobrepor aos da viagem para partilhar o mesmo autocarro e lugares.';
  }
  return null;
}

/**
 * A sensible default boarding time for a new route: the clock time that route
 * usually leaves at (e.g. Gamek at 20:00), on the journey's own date, as long
 * as it falls inside the journey. Otherwise the journey's own departure.
 */
export function suggestDeparture({ runDeparture, runEarliestArrival, usualDeparture }) {
  const run = new Date(runDeparture);
  if (!usualDeparture) return run.toISOString();
  const luandaDay = new Date(run.getTime() + LUANDA_OFFSET_MS).toISOString().slice(0, 10);
  const clock = new Date(new Date(usualDeparture).getTime() + LUANDA_OFFSET_MS).toISOString().slice(11, 16);
  const candidate = new Date(`${luandaDay}T${clock}:00+01:00`);
  if (candidate >= run && candidate < new Date(runEarliestArrival)) return candidate.toISOString();
  return run.toISOString();
}
