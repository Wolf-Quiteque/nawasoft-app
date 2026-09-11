// Regression tests for how NAWASOFT counts passengers on a bus.
// Bug fixed 2026-09-11: the ZONG TONG left Kikolo at 18:00 and picked up at
// Gamek at 20:00 on the same drive. The app treated those as two journeys and
// the home screen showed 9/52 for a bus that was really 52/52.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupTripsIntoRuns,
  attachSoldCounts,
  pickCurrentRun,
  currentRunByBus,
  summarizeOrigins,
} from '../lib/trip-runs.js';

const ZONG = { id: 'bus-zong', license_plate: 'LDA-02-42-AJ', capacity: 53 };
const HIGER = { id: 'bus-higer', license_plate: 'LDA-50-08-AN', capacity: 51 };

function trip(id, bus, origin, destination, departure, arrival, extra = {}) {
  return {
    id,
    bus_id: bus.id,
    bus,
    departure_time: departure,
    arrival_time: arrival,
    status: 'scheduled',
    sales_capacity_limit: null,
    route: { origin_city: origin, destination_city: destination },
    ...extra,
  };
}

// The real journey from 11 Sep 2026 (UTC; Luanda is UTC+1).
const tonight = () => [
  trip('kik-ben', ZONG, 'Kikolo', 'Benguela', '2026-09-11T17:00:00Z', '2026-09-12T03:00:00Z'),
  trip('kik-sum', ZONG, 'Kikolo', 'Sumbe', '2026-09-11T17:00:00Z', '2026-09-12T00:00:00Z'),
  trip('gam-ben', ZONG, 'Gamek', 'Benguela', '2026-09-11T19:00:00Z', '2026-09-12T03:00:00Z'),
  trip('gam-sum', ZONG, 'Gamek', 'Sumbe', '2026-09-11T19:00:00Z', '2026-09-12T00:00:00Z'),
];
const tomorrow = () => [
  trip('ben-lua-12', ZONG, 'Benguela', 'Luanda', '2026-09-12T17:00:00Z', '2026-09-13T03:00:00Z'),
];
const soldTonight = new Map([['kik-ben', 43], ['gam-ben', 9], ['ben-lua-12', 10]]);

test('pickups at different times on the same drive form one run', () => {
  const runs = groupTripsIntoRuns(tonight());
  assert.equal(runs.length, 1);
  assert.equal(runs[0].trips.length, 4);
  assert.equal(runs[0].departure_time, '2026-09-11T17:00:00Z');
  assert.equal(runs[0].arrival_time, '2026-09-12T03:00:00Z');
});

test('a full bus with two pickup terminals reads 52/52, not 9/52', () => {
  const [run] = attachSoldCounts(groupTripsIntoRuns(tonight()), soldTonight);
  assert.equal(run.sold, 52);
  assert.equal(run.capacity, 52, 'capacity is 53 seats minus the co-pilot seat');
  assert.equal(run.remaining, 0);
});

test('the order trips arrive in does not change the grouping', () => {
  const runs = groupTripsIntoRuns([...tonight()].reverse());
  assert.equal(runs.length, 1);
  assert.equal(runs[0].trips.length, 4);
});

test("the next day's journey on the same bus is a separate run", () => {
  const runs = groupTripsIntoRuns([...tomorrow(), ...tonight()]);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map((r) => r.trips.length), [4, 1]);
});

test('a trip leaving exactly when the previous one arrives is a separate run', () => {
  // Same strict "<" rule as the database's get_overlapping_trip_ids.
  const runs = groupTripsIntoRuns([
    trip('a', ZONG, 'Luanda', 'Benguela', '2026-09-11T08:00:00Z', '2026-09-11T16:00:00Z'),
    trip('b', ZONG, 'Benguela', 'Luanda', '2026-09-11T16:00:00Z', '2026-09-12T00:00:00Z'),
  ]);
  assert.equal(runs.length, 2);
});

test('different buses at the same time are never merged', () => {
  const runs = groupTripsIntoRuns([
    ...tonight(),
    trip('higer', HIGER, 'Benguela', 'Luanda', '2026-09-11T17:00:00Z', '2026-09-12T03:00:00Z'),
  ]);
  assert.equal(runs.length, 2);
  assert.ok(runs.every((r) => new Set(r.trips.map((t) => t.bus_id)).size === 1));
});

test('a sales limit on any leg caps the whole run', () => {
  const trips = tonight();
  trips[2].sales_capacity_limit = 40;
  const [run] = attachSoldCounts(groupTripsIntoRuns(trips), new Map([['kik-ben', 30]]));
  assert.equal(run.capacity, 40);
  assert.equal(run.remaining, 10);
});

test('home screen keeps the run under way per bus, not the last one processed', () => {
  // Tomorrow's run is listed first on purpose: a plain Map keyed by bus
  // would keep whichever run came last and lose tonight's full load.
  const runs = attachSoldCounts(groupTripsIntoRuns([...tomorrow(), ...tonight()]), soldTonight);

  const beforeDeparture = currentRunByBus(runs, Date.parse('2026-09-11T12:00:00Z')).get(ZONG.id);
  assert.equal(beforeDeparture.departure_time, '2026-09-11T17:00:00Z');
  assert.equal(beforeDeparture.sold, 52);

  const betweenPickups = currentRunByBus(runs, Date.parse('2026-09-11T18:30:00Z')).get(ZONG.id);
  assert.equal(betweenPickups.sold, 52, 'still the same journey after the Kikolo pickup');

  const nextDay = currentRunByBus(runs, Date.parse('2026-09-12T05:00:00Z')).get(ZONG.id);
  assert.equal(nextDay.departure_time, '2026-09-12T17:00:00Z');

  const allDone = currentRunByBus(runs, Date.parse('2026-09-20T00:00:00Z')).get(ZONG.id);
  assert.equal(allDone.departure_time, '2026-09-12T17:00:00Z', 'falls back to the last run');
});

test('pickCurrentRun returns null when a bus has no runs', () => {
  assert.equal(pickCurrentRun([]), null);
});

test('passengers are counted per pickup city with a destination split', () => {
  const [run] = attachSoldCounts(groupTripsIntoRuns(tonight()), soldTonight);
  const origins = summarizeOrigins(run.trips);
  assert.deepEqual(
    origins.map((o) => [o.origin_city, o.sold]),
    [['Kikolo', 43], ['Gamek', 9]]
  );
  const kikolo = Object.fromEntries(origins[0].destinations.map((d) => [d.destination_city, d.sold]));
  assert.deepEqual(kikolo, { Benguela: 43, Sumbe: 0 });
  assert.equal(origins[1].departure_time, '2026-09-11T19:00:00Z');
});
