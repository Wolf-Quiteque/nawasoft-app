import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { loadRun, getRunTripIds } from '@/lib/trip-run-detail';
import { MAX_PRICE_KZ, readPrice } from '@/lib/trip-price';
import { loadTrips } from '@/lib/queries/trips';

function localDate(iso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Luanda', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

function rpcError(error) {
  const message = String(error?.message || 'Não foi possível alterar a viagem.');
  const translations = [
    [/Journey has passengers/i, 'Esta viagem tem passageiros e não pode ser eliminada.'],
    [/active seat holds/i, 'Existem lugares temporariamente reservados online. Aguarde alguns minutos e tente novamente.'],
    [/active cargo/i, 'Esta viagem tem mercadoria ativa e não pode ser eliminada.'],
    [/Passengers have already boarded/i, 'Já existem passageiros embarcados nesta viagem.'],
    [/does not have enough passenger seats|do not fit/i, 'Os passageiros não cabem no autocarro selecionado.'],
    [/Target journey does not contain every route/i, 'A viagem de destino não contém todos os percursos da viagem atual.'],
    [/occupied at this time|already assigned/i, 'O autocarro selecionado já está ocupado nesse horário.'],
    [/Bus or driver is already assigned/i, 'O autocarro ou motorista já está ocupado no novo horário.'],
    [/Routes must overlap/i, 'Os horários dos percursos precisam sobrepor-se para partilhar o mesmo autocarro.'],
  ];
  return translations.find(([pattern]) => pattern.test(message))?.[1] || message;
}

export async function GET(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const supabase = createSupabaseAdminClient({ actorUserId: auth.user.id, actorRole: auth.profile.role });
  try {
    const run = await loadRun(supabase, id);
    if (!run) return NextResponse.json({ error: 'Viagem não encontrada.' }, { status: 404 });
    const [{ data: buses, error: busError }, day] = await Promise.all([
      supabase
        .from('buses')
        .select('id, license_plate, make, model, capacity, company_id, is_active')
        .eq('company_id', run.company_id)
        .eq('is_active', true)
        .order('license_plate'),
      loadTrips(localDate(run.departure_time)),
    ]);
    if (busError) throw busError;

    const routeKey = (leg) => `${String(leg.origin_city || '').trim().toLowerCase()}→${String(leg.destination_city || '').trim().toLowerCase()}`;
    const sourceRoutes = new Set(run.legs.map(routeKey));
    const mergeCandidates = (day.runs || [])
      .filter((candidate) => candidate.bus?.id !== run.bus?.id)
      .filter((candidate) => {
        const routes = new Set(candidate.legs.map(routeKey));
        return [...sourceRoutes].every((routeId) => routes.has(routeId));
      })
      .map((candidate) => ({
        trip_id: candidate.legs[0].trip_id,
        bus: candidate.bus,
        departure_time: candidate.departure_time,
        sold: candidate.sold,
        capacity: candidate.capacity,
        remaining_after_merge: candidate.capacity - candidate.sold - run.sold,
      }));

    return NextResponse.json({
      run,
      buses: (buses || []).filter((bus) => bus.id !== run.bus?.id),
      merge_candidates: mergeCandidates,
      viewer_role: auth.profile.role,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const supabase = createSupabaseAdminClient({ actorUserId: auth.user.id, actorRole: auth.profile.role });

  // Prices are money, so only an admin may change them — and only on trips that
  // belong to this run, never an arbitrary trip id sent from the browser.
  // Tickets already sold keep the price they were sold at.
  if (body.action === 'update_prices') {
    if (auth.profile.role !== 'admin') {
      return NextResponse.json({ error: 'Só administradores podem alterar preços.' }, { status: 403 });
    }
    if (!Array.isArray(body.prices) || !body.prices.length) {
      return NextResponse.json({ error: 'Indique os preços a guardar.' }, { status: 400 });
    }
    const runTripIds = new Set(await getRunTripIds(supabase, id));
    const updates = [];
    for (const entry of body.prices) {
      if (!runTripIds.has(entry?.trip_id)) {
        return NextResponse.json({ error: 'Percurso fora desta viagem.' }, { status: 400 });
      }
      const counter = readPrice(entry.price_kz);
      const online = readPrice(entry.online_price_kz);
      if (counter === undefined || online === undefined) {
        return NextResponse.json({ error: `Preço inválido (entre 0 e ${MAX_PRICE_KZ.toLocaleString('pt-AO')} Kz).` }, { status: 400 });
      }
      if (counter === null) {
        return NextResponse.json({ error: 'O preço de balcão é obrigatório.' }, { status: 400 });
      }
      updates.push({ trip_id: entry.trip_id, price_usd: counter, online_price_kz: online });
    }
    for (const update of updates) {
      const { error } = await supabase
        .from('trips')
        .update({ price_usd: update.price_usd, online_price_kz: update.online_price_kz })
        .eq('id', update.trip_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, action: 'update_prices', updated: updates.length });
  }

  const calls = {
    cancel: ['nawasoft_cancel_empty_run', { p_trip_id: id }],
    update_times: ['nawasoft_update_run_times', { p_trip_id: id, p_legs: body.legs }],
    replace_bus: ['nawasoft_replace_run_bus', { p_trip_id: id, p_new_bus_id: body.bus_id }],
    merge: ['nawasoft_merge_runs', { p_source_trip_id: id, p_target_trip_id: body.target_trip_id }],
  };
  const selected = calls[body.action];
  if (!selected) return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  if (body.action === 'replace_bus' && !body.bus_id) return NextResponse.json({ error: 'Selecione o novo autocarro.' }, { status: 400 });
  if (body.action === 'merge' && !body.target_trip_id) return NextResponse.json({ error: 'Selecione a viagem de destino.' }, { status: 400 });
  if (body.action === 'update_times' && !Array.isArray(body.legs)) return NextResponse.json({ error: 'Indique os horários de todos os percursos.' }, { status: 400 });

  const { data, error } = await supabase.rpc(selected[0], selected[1]);
  if (error) return NextResponse.json({ error: rpcError(error) }, { status: ['23503', '23P01', '22023', '55P03'].includes(error.code) ? 409 : 500 });
  return NextResponse.json({ success: true, action: body.action, result: data });
}
