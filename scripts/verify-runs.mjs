// Checks NAWASOFT's bus-run grouping against the live database.
//
//   npm run verify:runs         (next 14 days)
//   npm run verify:runs -- 30   (next 30 days)
//
// For every upcoming trip it confirms that:
//   1. every live trip the database says shares seats with it
//      (get_overlapping_trip_ids) sits in the same NAWASOFT run, and
//   2. the free seats NAWASOFT shows match the database's available_seats.
// Exits with code 1 if anything disagrees. Needs SUPABASE_SERVICE_ROLE_KEY
// and NEXT_PUBLIC_SUPABASE_URL (read from .env.local if not in the env).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupTripsIntoRuns, runEffectiveCapacity } from '../lib/trip-runs.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !env[match[1]]) env[match[1]] = match[2].trim();
    }
  } catch {
    // no .env.local; rely on the process environment
  }
  return env;
}

const env = loadEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const days = Number(process.argv[2] || 14);
const fromIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const toIso = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();

const { data: trips, error: tripsError } = await supabase
  .from('trips')
  .select('id, bus_id, departure_time, arrival_time, status, sales_capacity_limit, available_seats, bus:buses(id, license_plate, capacity), route:routes(origin_city, destination_city)')
  .gte('departure_time', fromIso)
  .lte('departure_time', toIso)
  .in('status', ['scheduled', 'boarding'])
  .order('departure_time');
if (tripsError) throw tripsError;

const liveIds = new Set(trips.map((t) => t.id));
const runs = groupTripsIntoRuns(trips);
const runByTripId = new Map();
for (const run of runs) for (const t of run.trips) runByTripId.set(t.id, run);

// Distinct occupied seats per trip.
const seatsByTrip = new Map();
const ids = [...liveIds];
for (let i = 0; i < ids.length; i += 200) {
  const { data: tickets, error } = await supabase
    .from('tickets')
    .select('trip_id, seat_number')
    .in('trip_id', ids.slice(i, i + 200))
    .in('status', ['active', 'pending', 'used']);
  if (error) throw error;
  for (const t of tickets) {
    if (!seatsByTrip.has(t.trip_id)) seatsByTrip.set(t.trip_id, new Set());
    seatsByTrip.get(t.trip_id).add(Number(t.seat_number));
  }
}

const label = (t) =>
  `${t.bus?.license_plate} ${t.route?.origin_city}->${t.route?.destination_city} ${t.departure_time}`;

const membershipProblems = [];
for (let i = 0; i < trips.length; i += 10) {
  await Promise.all(
    trips.slice(i, i + 10).map(async (t) => {
      const { data, error } = await supabase.rpc('get_overlapping_trip_ids', { p_trip_id: t.id });
      if (error) throw error;
      const run = runByTripId.get(t.id);
      const inRun = new Set(run.trips.map((x) => x.id));
      for (const { id } of data || []) {
        if (liveIds.has(id) && !inRun.has(id)) {
          membershipProblems.push(`${label(t)} shares seats with ${label(trips.find((x) => x.id === id))} in the DB but not in NAWASOFT`);
        }
      }
    })
  );
}

const seatProblems = [];
for (const run of runs) {
  const occupied = new Set();
  for (const t of run.trips) for (const seat of seatsByTrip.get(t.id) || []) occupied.add(seat);
  const appRemaining = Math.max(runEffectiveCapacity(run) - occupied.size, 0);
  for (const t of run.trips) {
    if (t.available_seats != null && t.available_seats !== appRemaining) {
      seatProblems.push(`${label(t)}: NAWASOFT shows ${appRemaining} free, DB available_seats=${t.available_seats}`);
    }
  }
}

console.log(`Checked ${trips.length} trips in ${runs.length} bus runs (next ${days} days).`);
if (membershipProblems.length) {
  console.log(`\nGrouping disagrees with the database (${membershipProblems.length}):`);
  membershipProblems.forEach((p) => console.log(`  - ${p}`));
}
if (seatProblems.length) {
  console.log(`\nFree-seat counts disagree with the database (${seatProblems.length}):`);
  seatProblems.forEach((p) => console.log(`  - ${p}`));
}
if (membershipProblems.length || seatProblems.length) process.exit(1);
console.log('All runs match the database.');
