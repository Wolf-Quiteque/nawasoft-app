import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import {
  addDays,
  boundsFor,
  departureFor,
  intervalsOverlap,
  recurringDates,
  shareOneSeatPool,
  TIME_PATTERN,
} from '@/lib/trip-schedule';
import { MAX_PRICE_KZ, priceInvalid, readPrice, tripPrices } from '@/lib/trip-price';

const ACTIVE = ['scheduled', 'boarding'];
const CLASS_MULTIPLIER = { economy: 1, business: 1.5, first: 2 };
const MAX_ROWS = 5000;

function addMonths(date, months) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result.toISOString().slice(0, 10);
}

export async function GET() {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const supabase = createSupabaseAdminClient({ actorUserId: auth.user.id, actorRole: auth.profile.role });
  const companyId = auth.profile.company_id || null;
  const companyQuery = supabase.from('companies').select('id, name').order('name');
  const busQuery = supabase.from('buses').select('id, company_id, license_plate, make, model, capacity').eq('is_active', true).order('license_plate');
  const routeQuery = supabase.from('routes').select('id, company_id, origin_city, origin_province, destination_city, destination_province, base_price_usd').eq('is_active', true).order('origin_city');
  const driverQuery = supabase.from('profiles').select('id, company_id, first_name, last_name').eq('role', 'driver').order('first_name');
  if (companyId) {
    companyQuery.eq('id', companyId);
    busQuery.eq('company_id', companyId);
    routeQuery.eq('company_id', companyId);
    driverQuery.eq('company_id', companyId);
  }
  const [companies, buses, routes, drivers] = await Promise.all([companyQuery, busQuery, routeQuery, driverQuery]);
  const error = companies.error || buses.error || routes.error || drivers.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    companies: companies.data || [], buses: buses.data || [], routes: routes.data || [], drivers: drivers.data || [],
    default_company_id: companyId || companies.data?.[0]?.id || null,
    viewer_role: auth.profile.role,
  });
}

export async function POST(request) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({}));
  const {
    company_id, bus_id, driver_id, start_date, end_date,
    recurrence_mode = 'weekdays', weekdays = [], interval_days = 1,
    weekday_offsets = {}, seat_class = 'economy', is_campaign = false,
    legs = [], round_trip = false, return_day_offset = 1, return_legs = [], dry_run = false,
  } = body;

  if (!company_id || !bus_id || !driver_id || !start_date || !end_date) return NextResponse.json({ error: 'Preencha empresa, autocarro, motorista e período.' }, { status: 400 });
  if (auth.profile.company_id && auth.profile.company_id !== company_id) return NextResponse.json({ error: 'A empresa selecionada não pertence à sua conta.' }, { status: 403 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date) || end_date < start_date) return NextResponse.json({ error: 'Período inválido.' }, { status: 400 });
  if (end_date > addMonths(start_date, 12)) return NextResponse.json({ error: 'Pode programar no máximo 12 meses.' }, { status: 400 });
  if (!CLASS_MULTIPLIER[seat_class]) return NextResponse.json({ error: 'Classe inválida.' }, { status: 400 });
  if (typeof is_campaign !== 'boolean' || typeof round_trip !== 'boolean' || typeof dry_run !== 'boolean') return NextResponse.json({ error: 'Opções da programação inválidas.' }, { status: 400 });
  if (!Number.isInteger(return_day_offset) || return_day_offset < 0 || return_day_offset > 7) return NextResponse.json({ error: 'O regresso deve ocorrer entre o mesmo dia e sete dias depois.' }, { status: 400 });
  if (!['weekdays', 'interval'].includes(recurrence_mode)) return NextResponse.json({ error: 'Frequência inválida.' }, { status: 400 });
  if (recurrence_mode === 'weekdays' && (!Array.isArray(weekdays) || !weekdays.length)) return NextResponse.json({ error: 'Escolha pelo menos um dia da semana.' }, { status: 400 });
  if (!Number.isInteger(interval_days) || interval_days < 1 || interval_days > 30) return NextResponse.json({ error: 'O intervalo deve estar entre 1 e 30 dias.' }, { status: 400 });
  if (!weekday_offsets || Array.isArray(weekday_offsets) || typeof weekday_offsets !== 'object' || Object.entries(weekday_offsets).some(([day, offset]) => !/^[0-6]$/.test(day) || !Number.isFinite(Number(offset)) || Number(offset) < -720 || Number(offset) > 720)) return NextResponse.json({ error: 'Os ajustes diários devem ficar entre -12 e 12 horas.' }, { status: 400 });
  if (!Array.isArray(legs) || !legs.length || legs.length > 20 || !Array.isArray(return_legs) || return_legs.length > 20 || (round_trip && !return_legs.length)) return NextResponse.json({ error: 'Adicione os percursos da ida e, se necessário, do regresso.' }, { status: 400 });

  // Creating trips at the route's default price is ordinary staff work;
  // setting a different price is not, so that alone requires an admin.
  const overridesPrice = [...legs, ...return_legs].some(
    (leg) => readPrice(leg?.price_kz) !== null || readPrice(leg?.online_price_kz) !== null
  );
  if (overridesPrice && auth.profile.role !== 'admin') {
    return NextResponse.json({ error: 'Só administradores podem definir um preço diferente do preço base da rota.' }, { status: 403 });
  }

  const groups = [['ida', legs], ['regresso', round_trip ? return_legs : []]];
  for (const [label, items] of groups) {
    if (new Set(items.map((leg) => leg.route_id)).size !== items.length) return NextResponse.json({ error: `Não repita rotas de ${label}.` }, { status: 400 });
    for (const leg of items) {
      if (!leg.route_id || !TIME_PATTERN.test(leg.departure_time || '') || !Number.isInteger(leg.duration_minutes) || leg.duration_minutes < 1 || leg.duration_minutes > 10080) return NextResponse.json({ error: `Revise rota, hora e duração de ${label}.` }, { status: 400 });
      if (priceInvalid(leg.price_kz) || priceInvalid(leg.online_price_kz)) return NextResponse.json({ error: `Revise os preços de ${label} (entre 0 e ${MAX_PRICE_KZ.toLocaleString('pt-AO')} Kz).` }, { status: 400 });
    }
    if (items.length) {
      const sample = items.map((leg) => {
        const departure = departureFor('2026-01-05', leg.departure_time);
        return { departure_time: departure.toISOString(), arrival_time: new Date(departure.getTime() + leg.duration_minutes * 60_000).toISOString() };
      });
      if (!shareOneSeatPool(sample)) return NextResponse.json({ error: `As rotas de ${label} não se sobrepõem e não podem partilhar o mesmo autocarro.` }, { status: 400 });
    }
  }

  const supabase = createSupabaseAdminClient({ actorUserId: auth.user.id, actorRole: auth.profile.role });
  const routeIds = [...new Set([...legs, ...(round_trip ? return_legs : [])].map((leg) => leg.route_id))];
  const [busResult, driverResult, routesResult] = await Promise.all([
    supabase.from('buses').select('id').eq('id', bus_id).eq('company_id', company_id).eq('is_active', true).maybeSingle(),
    supabase.from('profiles').select('id').eq('id', driver_id).eq('role', 'driver').maybeSingle(),
    supabase.from('routes').select('id, origin_city, destination_city, base_price_usd').eq('company_id', company_id).eq('is_active', true).in('id', routeIds),
  ]);
  if (busResult.error || driverResult.error || routesResult.error) return NextResponse.json({ error: (busResult.error || driverResult.error || routesResult.error).message }, { status: 500 });
  if (!busResult.data || !driverResult.data || routesResult.data?.length !== routeIds.length) return NextResponse.json({ error: 'Autocarro, motorista ou rota inválida/inativa.' }, { status: 400 });
  const routeById = new Map(routesResult.data.map((route) => [route.id, route]));

  const dates = recurringDates(start_date, end_date, recurrence_mode, weekdays, interval_days);
  const planned = [];
  const append = (date, direction, items, cycleDate) => {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const offset = Number(weekday_offsets[weekday] || 0);
    for (const leg of items) {
      const departure = departureFor(date, leg.departure_time, offset);
      const route = routeById.get(leg.route_id);
      // The counter (Sunmi) price falls back to the route's base price; the
      // online price falls back to null, which every client reads as "same as
      // the counter". A campaign trip is free on both.
      const prices = tripPrices({
        priceKz: leg.price_kz,
        onlinePriceKz: leg.online_price_kz,
        basePrice: Number(route.base_price_usd) * CLASS_MULTIPLIER[seat_class],
        isCampaign: is_campaign,
      });
      planned.push({
        service_date: date, run_key: `${cycleDate}:${direction}`, route_id: leg.route_id, bus_id, driver_id, company_id,
        departure_time: departure.toISOString(), arrival_time: new Date(departure.getTime() + leg.duration_minutes * 60_000).toISOString(),
        seat_class, status: 'scheduled', is_campaign,
        ...prices,
        route,
      });
    }
  };
  for (const date of dates) {
    append(date, 'ida', legs, date);
    if (round_trip) append(addDays(date, return_day_offset), 'regresso', return_legs, date);
  }
  if (!planned.length) return NextResponse.json({ error: 'Nenhuma data corresponde à programação.' }, { status: 400 });
  if (planned.length > MAX_ROWS) return NextResponse.json({ error: `A programação excede ${MAX_ROWS} percursos.` }, { status: 400 });

  const runs = new Map();
  for (const trip of planned) runs.set(trip.run_key, [...(runs.get(trip.run_key) || []), trip]);
  const bounds = [...runs.values()].map(boundsFor).sort((a, b) => a.departure_time.localeCompare(b.departure_time));
  let blockingRun = bounds[0];
  for (let index = 1; index < bounds.length; index += 1) {
    if (intervalsOverlap(blockingRun, bounds[index])) return NextResponse.json({ error: 'Duas viagens planeadas usam o mesmo autocarro ao mesmo tempo.' }, { status: 409 });
    if (bounds[index].arrival_time > blockingRun.arrival_time) blockingRun = bounds[index];
  }

  const searchStart = new Date(new Date(bounds[0].departure_time).getTime() - 8 * 24 * 60 * 60_000).toISOString();
  const searchEnd = new Date(new Date(bounds.at(-1).arrival_time).getTime() + 24 * 60 * 60_000).toISOString();
  const [busTrips, driverTrips] = await Promise.all([
    supabase.from('trips').select('id, route_id, bus_id, driver_id, departure_time, arrival_time').eq('bus_id', bus_id).in('status', ACTIVE).gte('departure_time', searchStart).lt('departure_time', searchEnd).range(0, 9999),
    supabase.from('trips').select('id, route_id, bus_id, driver_id, departure_time, arrival_time').eq('driver_id', driver_id).in('status', ACTIVE).gte('departure_time', searchStart).lt('departure_time', searchEnd).range(0, 9999),
  ]);
  if (busTrips.error || driverTrips.error) return NextResponse.json({ error: (busTrips.error || driverTrips.error).message }, { status: 500 });
  const key = (routeId, departure) => `${routeId}:${new Date(departure).toISOString()}`;
  const existingKeys = new Set((busTrips.data || []).map((trip) => key(trip.route_id, trip.departure_time)));
  const toCreate = planned.filter((trip) => !existingKeys.has(key(trip.route_id, trip.departure_time)));
  const plannedKeys = new Set(planned.map((trip) => key(trip.route_id, trip.departure_time)));
  const existing = new Map([...(busTrips.data || []), ...(driverTrips.data || [])].map((trip) => [trip.id, trip]));
  const conflicts = [];
  for (const run of bounds) {
    for (const trip of existing.values()) {
      if (!intervalsOverlap(run, trip)) continue;
      const duplicate = trip.bus_id === bus_id && trip.driver_id === driver_id && plannedKeys.has(key(trip.route_id, trip.departure_time));
      if (!duplicate) conflicts.push({ trip_id: trip.id, departure_time: trip.departure_time, type: trip.bus_id === bus_id ? 'bus' : 'driver' });
    }
  }

  const previewRows = planned.slice(0, 500).map((trip) => ({
    date: trip.service_date, direction: trip.run_key.endsWith(':ida') ? 'Ida' : 'Regresso',
    route: `${trip.route.origin_city} → ${trip.route.destination_city}`,
    departure_time: trip.departure_time, arrival_time: trip.arrival_time,
    price_usd: trip.price_usd, online_price_kz: trip.online_price_kz,
  }));
  const result = { valid: conflicts.length === 0, created: toCreate.length, skipped: planned.length - toCreate.length, total: planned.length, conflicts: conflicts.slice(0, 50), preview: previewRows };
  if (dry_run) return NextResponse.json(result);
  if (conflicts.length) return NextResponse.json({ ...result, error: 'Existem conflitos de autocarro ou motorista.' }, { status: 409 });
  if (toCreate.length) {
    const rows = toCreate.map(({ service_date: _date, run_key: _key, route: _route, ...trip }) => trip);
    const { error } = await supabase.from('trips').insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(result, { status: 201 });
}
