'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bus, Clock3, Merge, Trash2, ChevronLeft, MapPinPlus, MapPinOff, Tag, Split } from 'lucide-react';
import Sheet from '@/components/ui/Sheet';
import Button from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import AddBoardingPoints from '@/components/AddBoardingPoints';
import UnifyRuns from '@/components/UnifyRuns';

function localInput(iso) {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Luanda', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

function toIso(value) {
  return new Date(`${value}:00+01:00`).toISOString();
}

const actions = [
  { id: 'times', title: 'Editar horários', detail: 'Altere partida e chegada de cada percurso.', icon: Clock3 },
  { id: 'prices', title: 'Alterar preços', detail: 'Preço de balcão/Sunmi e preço online de cada percurso.', icon: Tag },
  { id: 'legs', title: 'Adicionar embarque', detail: 'Mais pontos de embarque neste autocarro, com os mesmos lugares.', icon: MapPinPlus },
  { id: 'bus', title: 'Trocar autocarro', detail: 'Passa a viagem e os passageiros para outro autocarro livre.', icon: Bus },
  { id: 'remove_legs', title: 'Remover percurso', detail: 'Tira percursos sem passageiros deste autocarro; os outros continuam.', icon: MapPinOff },
  { id: 'split', title: 'Separar por origem', detail: 'Passa os passageiros de uma origem para outro autocarro, nos mesmos lugares.', icon: Split },
  { id: 'merge', title: 'Juntar noutra viagem', detail: 'Une os passageiros com outro autocarro que tenha lugares.', icon: Merge },
  { id: 'cancel', title: 'Eliminar viagem', detail: 'Disponível apenas quando não há passageiros.', icon: Trash2, danger: true },
];

export default function TripManageSheet({ open, onClose, tripId, run, onChanged, toast }) {
  const [screen, setScreen] = useState('menu');
  const [options, setOptions] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busId, setBusId] = useState('');
  const [legs, setLegs] = useState([]);
  const [prices, setPrices] = useState([]);
  const [removeIds, setRemoveIds] = useState([]);
  const [splitOrigin, setSplitOrigin] = useState('');
  const [splitBus, setSplitBus] = useState('');
  const [splitDriver, setSplitDriver] = useState('');
  const [splitPreview, setSplitPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setScreen('menu');
    setOptions(null);
    setBusId('');
    setRemoveIds([]);
    setSplitOrigin('');
    setSplitBus('');
    setSplitDriver('');
    setSplitPreview(null);
    setPrices((run?.legs || []).map((leg) => ({
      trip_id: leg.trip_id,
      label: `${leg.origin_city} → ${leg.destination_city}`,
      sold: leg.sold,
      base_price_usd: leg.base_price_usd,
      price_kz: leg.price_usd == null ? '' : String(leg.price_usd),
      online_price_kz: leg.online_price_kz == null ? '' : String(leg.online_price_kz),
    })));
    setLegs((run?.legs || []).map((leg) => ({
      trip_id: leg.trip_id,
      label: `${leg.origin_city} → ${leg.destination_city}`,
      departure: localInput(leg.departure_time),
      arrival: localInput(leg.arrival_time),
    })));
    fetch(`/api/trips/${tripId}/manage`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Falha ao carregar opções.');
        setOptions(body);
      })
      .catch((error) => toast(error.message, 'error'));
  }, [open, tripId, run, toast]);

  const selectedBus = useMemo(() => options?.buses?.find((bus) => bus.id === busId), [options, busId]);

  const finish = (action) => {
    onClose();
    onChanged?.(action);
  };

  const origins = useMemo(() => {
    const byOrigin = new Map();
    for (const leg of run?.legs || []) {
      const key = leg.origin_city || '';
      const cur = byOrigin.get(key) || { origin: key, sold: 0, legs: [] };
      cur.sold += Number(leg.sold) || 0;
      cur.legs.push(`${leg.origin_city} → ${leg.destination_city}`);
      byOrigin.set(key, cur);
    }
    return [...byOrigin.values()];
  }, [run]);

  // Any change to the choice makes the last preview stale.
  const chooseSplit = (setter) => (event) => {
    setter(event.target.value);
    setSplitPreview(null);
  };

  const previewSplit = async () => {
    setPreviewing(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/manage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'split_origin', origin_city: splitOrigin, bus_id: splitBus, driver_id: splitDriver, dry_run: true }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Não foi possível pré-visualizar.');
      setSplitPreview(body.result);
    } catch (error) {
      setSplitPreview(null);
      toast(error.message, 'error');
    } finally {
      setPreviewing(false);
    }
  };

  const submit = async (action, extra = {}) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/manage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Não foi possível alterar a viagem.');
      const changed = body.result?.seat_assignments?.filter((item) => item.old_seat !== item.new_seat).length || 0;
      const messages = {
        update_times: 'Horários atualizados com sucesso.',
        replace_bus: changed ? `Autocarro trocado. ${changed} passageiro(s) receberam novo assento.` : 'Autocarro trocado; todos os assentos foram mantidos.',
        cancel: 'Viagem eliminada com sucesso.',
        update_prices: 'Preços atualizados. Os bilhetes já vendidos mantêm o preço pago.',
      };
      if (action === 'remove_legs') {
        messages.remove_legs = `${extra.leg_ids.length} percurso(s) removido(s). Os restantes continuam à venda.`;
      }
      if (action === 'split_origin') {
        const r = body.result || {};
        messages.split_origin = `${r.passengers} passageiro(s) de ${r.origin} passaram para ${r.new_bus_plate}`
          + (r.seat_changes?.length ? ` · ${r.seat_changes.length} com lugar novo.` : ' nos mesmos lugares.');
      }
      toast(messages[action], 'success');
      finish(action);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={screen === 'menu' ? 'Gerir viagem' : actions.find((item) => item.id === screen)?.title} maxHeight="92vh">
      {screen !== 'menu' ? (
        <button className="mb-3 flex items-center gap-1 text-sm font-semibold text-primary" onClick={() => setScreen('menu')}>
          <ChevronLeft size={16} /> Voltar
        </button>
      ) : null}

      {screen === 'menu' ? (
        <div className="flex flex-col gap-2 pb-5">
          <p className="mb-1 text-sm text-muted-foreground">As alterações aplicam-se a todos os percursos que partilham este autocarro.</p>
          {actions
            .filter((action) => action.id !== 'prices' || options?.viewer_role === 'admin')
            // Splitting only makes sense when the bus picks up at more than one place.
            .filter((action) => action.id !== 'split' || origins.length > 1)
            .filter((action) => action.id !== 'remove_legs' || (run?.legs?.length || 0) > 1)
            .map((action) => {
            const Icon = action.icon;
            const disabled = action.id === 'cancel' && run?.sold > 0;
            return (
              <button key={action.id} disabled={disabled} onClick={() => setScreen(action.id)} className="text-left disabled:opacity-45">
                <Card className="flex items-center gap-3 p-3.5">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${action.danger ? 'bg-danger/10 text-danger' : 'bg-primary/10 text-primary'}`}><Icon size={18} /></span>
                  <span>
                    <span className={`block text-sm font-bold ${action.danger ? 'text-danger' : ''}`}>{action.title}</span>
                    <span className="block text-xs text-muted-foreground">{disabled ? `Bloqueado: ${run.sold} passageiro(s) nesta viagem.` : action.detail}</span>
                  </span>
                </Card>
              </button>
            );
          })}
        </div>
      ) : null}

      {screen === 'times' ? (
        <div className="space-y-3 pb-5">
          {legs.map((leg, index) => (
            <Card key={leg.trip_id} className="p-3">
              <p className="mb-2 text-sm font-bold">{leg.label}</p>
              <label className="text-xs text-muted-foreground">Partida</label>
              <input type="datetime-local" value={leg.departure} onChange={(event) => setLegs((items) => items.map((item, i) => i === index ? { ...item, departure: event.target.value } : item))} className="mb-2 mt-1 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
              <label className="text-xs text-muted-foreground">Chegada</label>
              <input type="datetime-local" value={leg.arrival} onChange={(event) => setLegs((items) => items.map((item, i) => i === index ? { ...item, arrival: event.target.value } : item))} className="mt-1 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
            </Card>
          ))}
          <Button className="w-full" loading={saving} disabled={legs.some((leg) => !leg.departure || !leg.arrival)} onClick={() => submit('update_times', { legs: legs.map((leg) => ({ trip_id: leg.trip_id, departure_time: toIso(leg.departure), arrival_time: toIso(leg.arrival) })) })}>Guardar horários</Button>
        </div>
      ) : null}

      {screen === 'prices' ? (
        <div className="space-y-3 pb-5">
          <p className="text-sm text-muted-foreground">
            O preço online em branco significa <strong className="text-foreground">igual ao balcão</strong>. Bilhetes já vendidos mantêm o preço que pagaram.
          </p>
          {prices.map((leg, index) => (
            <Card key={leg.trip_id} className="p-3">
              <p className="mb-2 text-sm font-bold">{leg.label}</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-muted-foreground">
                  Balcão / Sunmi (Kz)
                  <input
                    type="number" min="0" step="100" value={leg.price_kz}
                    onChange={(event) => setPrices((items) => items.map((item, i) => i === index ? { ...item, price_kz: event.target.value } : item))}
                    className="mt-1 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm"
                  />
                </label>
                <label className="text-[11px] text-muted-foreground">
                  Online (Kz)
                  <input
                    type="number" min="0" step="100" value={leg.online_price_kz}
                    placeholder={leg.price_kz || 'igual ao balcão'}
                    onChange={(event) => setPrices((items) => items.map((item, i) => i === index ? { ...item, online_price_kz: event.target.value } : item))}
                    className="mt-1 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm"
                  />
                </label>
              </div>
              {leg.sold > 0 ? <p className="mt-1.5 text-[10px] text-muted-foreground">{leg.sold} bilhete(s) já vendido(s) neste percurso.</p> : null}
            </Card>
          ))}
          <Button
            className="w-full" loading={saving}
            disabled={prices.some((leg) => leg.price_kz === '')}
            onClick={() => submit('update_prices', { prices: prices.map((leg) => ({ trip_id: leg.trip_id, price_kz: leg.price_kz, online_price_kz: leg.online_price_kz })) })}
          >
            Guardar preços
          </Button>
        </div>
      ) : null}

      {screen === 'legs' ? (
        <AddBoardingPoints tripId={tripId} toast={toast} onDone={() => finish('legs')} />
      ) : null}

      {screen === 'remove_legs' ? (
        <div className="space-y-3 pb-5">
          <p className="text-sm text-muted-foreground">
            Só se removem percursos <strong className="text-foreground">sem passageiros</strong>. Se ainda tiverem, passe-os primeiro
            para outro autocarro com "Separar por origem" ou reprograme-os.
          </p>
          {(run?.legs || []).map((leg) => {
            const empty = !(Number(leg.sold) > 0);
            const checked = removeIds.includes(leg.trip_id);
            return (
              <label key={leg.trip_id} className={`flex items-center gap-3 rounded-2xl border border-border bg-surface p-3.5 ${empty ? 'cursor-pointer' : 'opacity-60'}`}>
                <input
                  type="checkbox"
                  disabled={!empty}
                  checked={checked}
                  onChange={(event) => setRemoveIds((ids) => (event.target.checked ? [...ids, leg.trip_id] : ids.filter((id) => id !== leg.trip_id)))}
                  className="h-5 w-5 accent-[var(--color-primary)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-bold">{leg.origin_city} → {leg.destination_city}</span>
                  <span className="block text-xs text-muted-foreground">
                    {empty ? 'Sem passageiros' : `${leg.sold} passageiro(s) — mova-os primeiro`}
                  </span>
                </span>
              </label>
            );
          })}
          {removeIds.length > 0 && removeIds.length >= (run?.legs?.length || 0) ? (
            <p className="rounded-xl bg-danger/10 p-3 text-xs text-danger">
              Tem de ficar pelo menos um percurso. Para retirar a viagem toda, use "Eliminar viagem".
            </p>
          ) : null}
          <Button
            variant="danger" className="w-full" loading={saving}
            disabled={removeIds.length === 0 || removeIds.length >= (run?.legs?.length || 0)}
            onClick={() => submit('remove_legs', { leg_ids: removeIds })}
          >
            {removeIds.length ? `Remover ${removeIds.length} percurso(s)` : 'Escolha os percursos a remover'}
          </Button>
        </div>
      ) : null}

      {screen === 'split' ? (
        <div className="space-y-3 pb-5">
          <p className="text-sm text-muted-foreground">
            Os passageiros da origem escolhida passam para outro autocarro <strong className="text-foreground">nos mesmos lugares</strong>.
            Não é uma reprogramação: não se cobra nada e os bilhetes não mudam. As duas origens deixam de partilhar lugares.
          </p>

          <label className="block text-xs text-muted-foreground">Origem a separar
            <select value={splitOrigin} onChange={chooseSplit(setSplitOrigin)} className="mt-1 h-12 w-full rounded-2xl border border-border bg-surface px-3 text-sm text-foreground">
              <option value="">Escolher origem</option>
              {origins.map((o) => (
                <option key={o.origin} value={o.origin}>{o.origin} · {o.sold} passageiro(s)</option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-muted-foreground">Novo autocarro
            <select value={splitBus} onChange={chooseSplit(setSplitBus)} className="mt-1 h-12 w-full rounded-2xl border border-border bg-surface px-3 text-sm text-foreground">
              <option value="">Escolher autocarro</option>
              {(options?.buses || []).map((bus) => (
                <option key={bus.id} value={bus.id}>{bus.license_plate} · {Math.max(bus.capacity - 1, 0)} lugares comerciais</option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-muted-foreground">Motorista do novo autocarro
            <select value={splitDriver} onChange={chooseSplit(setSplitDriver)} className="mt-1 h-12 w-full rounded-2xl border border-border bg-surface px-3 text-sm text-foreground">
              <option value="">Escolher motorista</option>
              {(options?.drivers || []).map((d) => (
                <option key={d.id} value={d.id}>{`${d.first_name || ''} ${d.last_name || ''}`.trim() || 'Motorista'}</option>
              ))}
            </select>
          </label>

          {splitPreview ? (
            <Card className="space-y-1.5 p-3 text-sm">
              <p className="font-bold">
                {splitPreview.passengers} passageiro(s) de {splitPreview.origin} → {splitPreview.new_bus_plate}
              </p>
              <p className="text-muted-foreground">
                {splitPreview.seats_kept} mantêm o lugar
                {splitPreview.seat_changes?.length ? `, ${splitPreview.seat_changes.length} com lugar novo (o autocarro é mais pequeno):` : '.'}
              </p>
              {splitPreview.seat_changes?.length ? (
                <p className="text-xs text-muted-foreground">
                  {splitPreview.seat_changes.map((m) => `${m.old_seat} → ${m.new_seat}`).join(' · ')}
                </p>
              ) : null}
              {splitPreview.cancelled_duplicate_trip_ids?.length ? (
                <p className="text-xs text-warning">
                  O novo autocarro tinha uma viagem vazia igual nesse horário; será cancelada para não ficar duplicada.
                </p>
              ) : null}
            </Card>
          ) : null}

          {splitPreview ? (
            <Button className="w-full" loading={saving}
              onClick={() => submit('split_origin', { origin_city: splitOrigin, bus_id: splitBus, driver_id: splitDriver })}>
              Confirmar separação
            </Button>
          ) : (
            <Button className="w-full" variant="secondary" loading={previewing}
              disabled={!splitOrigin || !splitBus || !splitDriver} onClick={previewSplit}>
              Pré-visualizar
            </Button>
          )}
        </div>
      ) : null}

      {screen === 'bus' ? (
        <div className="space-y-3 pb-5">
          <p className="text-sm text-muted-foreground">Atual: <strong className="text-foreground">{run?.bus?.license_plate}</strong> · {run?.sold} passageiros. O sistema mantém cada assento quando existir no novo autocarro.</p>
          <select value={busId} onChange={(event) => setBusId(event.target.value)} className="h-12 w-full rounded-2xl border border-border bg-surface px-3 text-sm">
            <option value="">Escolher autocarro</option>
            {(options?.buses || []).map((bus) => <option key={bus.id} value={bus.id}>{bus.license_plate} · {Math.max(bus.capacity - 1, 0)} lugares comerciais</option>)}
          </select>
          {selectedBus && run?.sold > selectedBus.capacity - 1 ? <p className="rounded-xl bg-danger/10 p-3 text-xs text-danger">Os {run.sold} passageiros não cabem neste autocarro.</p> : null}
          <Button className="w-full" loading={saving} disabled={!busId || run?.sold > (selectedBus?.capacity || 0) - 1} onClick={() => submit('replace_bus', { bus_id: busId })}>Confirmar troca</Button>
        </div>
      ) : null}

      {screen === 'merge' ? (
        <UnifyRuns tripId={tripId} run={run} toast={toast} onDone={() => finish('merge')} />
      ) : null}

      {screen === 'cancel' ? (
        <div className="pb-5">
          <p className="rounded-xl bg-danger/10 p-3 text-sm text-danger">Esta ação retira todos os percursos desta viagem das vendas. Só funciona sem passageiros, reservas online ou mercadoria ativa.</p>
          <Button variant="danger" className="mt-4 w-full" loading={saving} onClick={() => submit('cancel')}>Eliminar viagem vazia</Button>
        </div>
      ) : null}
    </Sheet>
  );
}
