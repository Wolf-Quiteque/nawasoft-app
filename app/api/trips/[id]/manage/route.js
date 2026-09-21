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
    [/No leg of this journey leaves from that origin/i, 'Nenhum percurso desta viagem sai dessa origem.'],
    [/Route has passengers/i, 'Esse percurso ainda tem passageiros. Mova-os primeiro — por exemplo com "Separar por origem" ou reprogramando.'],
    [/At least one route must stay/i, 'Tem de ficar pelo menos um percurso. Para retirar a viagem toda, use "Eliminar viagem".'],
    [/Route is not part of this journey/i, 'Esse percurso não pertence a esta viagem.'],
    [/Choose at least one route/i, 'Escolha pelo menos um percurso.'],
    [/Every leg leaves from that origin/i, 'Todos os percursos saem dessa origem — use "Trocar autocarro".'],
    [/Choose a different bus/i, 'Escolha um autocarro diferente do atual.'],
    [/Choose a driver/i, 'Escolha um motorista para o novo autocarro.'],
    [/Driver is already assigned/i, 'Esse motorista já está noutra viagem nesse horário.'],
    [/online seat holds/i, 'Há lugares a ser pagos online neste momento. Aguarde alguns minutos e tente novamente.'],
    [/must be active and belong to the same company/i, 'O autocarro tem de estar ativo e ser da mesma empresa.'],
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
    const [{ data: buses, error: busError }, day, { data: drivers, error: driverError }] = await Promise.all([
      supabase
        .from('buses')
        .select('id, license_plate, make, model, capacity, company_id, is_active')
        .eq('company_id', run.company_id)
        .eq('is_active', true)
        .order('license_plate'),
      loadTrips(localDate(run.departure_time)),
      // Separar por origem needs a driver for the new bus.
      supabase
        .from('profiles')
        .select('id, first_name, last_name, company_id')
        .eq('role', 'driver')
        .or(`company_id.is.null,company_id.eq.${run.company_id}`)
        .order('first_name'),
    ]);
    if (busError) throw busError;
    if (driverError) throw driverError;

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
      drivers: drivers || [],
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
    // Take empty legs off the bus; the rest keep running.
    remove_legs: ['nawasoft_remove_run_legs', { p_trip_id: id, p_leg_ids: body.leg_ids }],
    // Move one origin's passengers to another bus, same trips and seats.
    split_origin: ['nawasoft_split_run_origin', {
      p_trip_id: id,
      p_origin_city: body.origin_city,
      p_new_bus_id: body.bus_id,
      p_new_driver_id: body.driver_id,
      p_dry_run: body.dry_run === true,
    }],
  };
  const selected = calls[body.action];
  if (!selected) return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  if (body.action === 'replace_bus' && !body.bus_id) return NextResponse.json({ error: 'Selecione o novo autocarro.' }, { status: 400 });
  if (body.action === 'merge' && !body.target_trip_id) return NextResponse.json({ error: 'Selecione a viagem de destino.' }, { status: 400 });
  if (body.action === 'remove_legs' && (!Array.isArray(body.leg_ids) || body.leg_ids.length === 0)) {
    return NextResponse.json({ error: 'Escolha pelo menos um percurso.' }, { status: 400 });
  }
  if (body.action === 'split_origin' && (!body.origin_city || !body.bus_id || !body.driver_id)) {
    return NextResponse.json({ error: 'Escolha a origem, o autocarro e o motorista.' }, { status: 400 });
  }
  if (body.action === 'update_times' && !Array.isArray(body.legs)) return NextResponse.json({ error: 'Indique os horários de todos os percursos.' }, { status: 400 });

  const { data, error } = await supabase.rpc(selected[0], selected[1]);
  if (error) return NextResponse.json({ error: rpcError(error) }, { status: ['23503', '23P01', '22023', '55P03'].includes(error.code) ? 409 : 500 });
  return NextResponse.json({ success: true, action: body.action, result: data });
}
