'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bus, Clock3, Merge, Trash2, ChevronLeft, MapPinPlus, Tag } from 'lucide-react';
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

  useEffect(() => {
    if (!open) return;
    setScreen('menu');
    setOptions(null);
    setBusId('');
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
          {actions.filter((action) => action.id !== 'prices' || options?.viewer_role === 'admin').map((action) => {
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
