// Adding boarding points to a journey and joining journeys onto another bus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingRoutes, validateNewLegs, suggestDeparture, routeKey } from '../lib/trip-legs.js';

// Kikolo 18:00 -> Sumbe 01:00 (UTC; Luanda is UTC+1).
const kikoloRun = [
  { origin_city: 'Kikolo', destination_city: 'Sumbe', departure_time: '2026-09-25T17:00:00Z', arrival_time: '2026-09-26T00:00:00Z' },
];

const gamekLegs = (price = 9000) => [
  { route_id: 'r1', origin_city: 'Gamek', destination_city: 'Sumbe', departure_time: '2026-09-25T19:00:00Z', arrival_time: '2026-09-26T00:00:00Z', price_usd: price },
  { route_id: 'r2', origin_city: 'Gamek', destination_city: 'Benguela', departure_time: '2026-09-25T19:00:00Z', arrival_time: '2026-09-26T03:00:00Z', price_usd: 11000 },
];

test('Gamek 20:00 boarding points can join a Kikolo 18:00 journey', () => {
  assert.equal(validateNewLegs(kikoloRun, gamekLegs()), null);
});

test('a route the bus already serves is rejected, whatever the spelling', () => {
  const duplicate = [{ ...kikoloRun[0], route_id: 'x', price_usd: 9000, origin_city: ' kikolo ', destination_city: 'SUMBE' }];
  assert.match(validateNewLegs(kikoloRun, duplicate), /já faz/);
});

test('a morning leg cannot share seats with a night journey', () => {
  const morning = [{
    route_id: 'r', origin_city: 'Gamek', destination_city: 'Sumbe',
    departure_time: '2026-09-25T09:00:00Z', arrival_time: '2026-09-25T14:00:00Z', price_usd: 9000,
  }];
  assert.match(validateNewLegs(kikoloRun, morning), /sobrepor/);
});

test('arrival must be after departure, and the fare above zero', () => {
  assert.match(validateNewLegs(kikoloRun, [{ ...gamekLegs()[0], arrival_time: '2026-09-25T18:00:00Z' }]), /depois/);
  assert.match(validateNewLegs(kikoloRun, gamekLegs(0).slice(0, 1)), /preço/);
});

test('joining lists only the routes the target bus lacks, once each', () => {
  const source = [...kikoloRun, { ...kikoloRun[0] }, { origin_city: 'Gamek', destination_city: 'Benguela' }];
  const target = [{ origin_city: 'Gamek', destination_city: 'Benguela' }];
  assert.deepEqual(missingRoutes(source, target).map(routeKey), [routeKey(kikoloRun[0])]);
});

test('suggested boarding time keeps the route usual clock time, on the journey date', () => {
  const suggestion = suggestDeparture({
    runDeparture: '2026-09-25T17:00:00Z',
    runEarliestArrival: '2026-09-26T00:00:00Z',
    usualDeparture: '2026-09-18T19:00:00Z', // Gamek usually leaves 20:00 Luanda
  });
  assert.equal(suggestion, '2026-09-25T19:00:00.000Z');
});

test('a usual time outside the journey falls back to the journey departure', () => {
  const suggestion = suggestDeparture({
    runDeparture: '2026-09-25T17:00:00Z',
    runEarliestArrival: '2026-09-26T00:00:00Z',
    usualDeparture: '2026-09-18T09:00:00Z', // a 10:00 morning habit
  });
  assert.equal(suggestion, '2026-09-25T17:00:00.000Z');
});
