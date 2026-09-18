'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatTime } from '@/lib/format';
import { validateNewLegs } from '@/lib/trip-legs';
import { cn } from '@/lib/cn';

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

function plusMinutes(localValue, minutes) {
  if (!localValue) return '';
  return localInput(new Date(new Date(toIso(localValue)).getTime() + minutes * 60_000).toISOString());
}

const inputClass = 'mt-1 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground';

/** Adds more boarding points (routes) to a journey, on the same bus and seats. */
export default function AddBoardingPoints({ tripId, toast, onDone }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState(null);
  const [departure, setDeparture] = useState('');
  const [picked, setPicked] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/trips/${tripId}/legs`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Falha ao carregar percursos.');
        return body;
      })
      .then((body) => { if (active) setData(body); })
      .catch((error) => toast(error.message, 'error'))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tripId, toast]);

  const chooseOrigin = (group) => {
    setOrigin(group);
    setDeparture(localInput(group.suggested_departure));
    setPicked({});
  };

  const changeDeparture = (value) => {
    setDeparture(value);
    // Moving the boarding time keeps each destination's journey length.
    setPicked((previous) => Object.fromEntries(Object.entries(previous).map(([routeId, value2]) => {
      const route = origin?.routes.find((item) => item.route_id === routeId);
      return [routeId, { ...value2, arrival: plusMinutes(value, route?.duration_minutes || 0) }];
    })));
  };

  const toggle = (route) => setPicked((previous) => {
    const next = { ...previous };
    if (next[route.route_id]) delete next[route.route_id];
    else next[route.route_id] = { arrival: plusMinutes(departure, route.duration_minutes), price: String(route.suggested_price || '') };
    return next;
  });

  const update = (routeId, field, value) =>
    setPicked((previous) => ({ ...previous, [routeId]: { ...previous[routeId], [field]: value } }));

  const newLegs = useMemo(() => Object.entries(picked).map(([routeId, value]) => {
    const route = origin?.routes.find((item) => item.route_id === routeId);
    return {
      route_id: routeId,
      origin_city: origin?.origin_city,
      destination_city: route?.destination_city,
      departure_time: departure ? toIso(departure) : null,
      arrival_time: value.arrival ? toIso(value.arrival) : null,
      price_usd: Number(value.price),
    };
  }), [picked, origin, departure]);

  const problem = newLegs.length ? validateNewLegs(data?.run?.legs || [], newLegs) : null;

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/legs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legs: newLegs.map(({ route_id, departure_time, arrival_time, price_usd }) => ({ route_id, departure_time, arrival_time, price_usd })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Não foi possível adicionar os percursos.');
      toast(`${newLegs.length} percurso(s) adicionado(s) e já à venda.`, 'success');
      onDone();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="pb-5 text-sm text-muted-foreground">A carregar percursos…</p>;
  if (!data) return null;

  return (
    <div className="space-y-3 pb-5">
      <p className="text-sm text-muted-foreground">
        Os novos embarques usam este mesmo autocarro ({data.run.bus?.license_plate}) e partilham os mesmos lugares.
      </p>

      <Card className="p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Percursos atuais</p>
        {data.run.legs.map((leg) => (
          <p key={leg.trip_id} className="mt-1 text-sm">
            {leg.origin_city} → {leg.destination_city} · {formatTime(leg.departure_time)}
          </p>
        ))}
      </Card>

      {data.origins.length ? (
        <>
          <p className="text-sm font-bold">Novo ponto de embarque</p>
          <div className="flex flex-wrap gap-2">
            {data.origins.map((group) => (
              <button
                key={group.origin_city}
                type="button"
                onClick={() => chooseOrigin(group)}
                className={cn(
                  'press-scale rounded-full border px-3.5 py-1.5 text-sm font-semibold',
                  origin?.origin_city === group.origin_city
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-surface'
                )}
              >
                {group.origin_city}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">Não há outros percursos ativos para adicionar.</p>
      )}

      {origin ? (
        <>
          <label className="block text-xs text-muted-foreground">
            Partida de {origin.origin_city}
            <input type="datetime-local" value={departure} onChange={(event) => changeDeparture(event.target.value)} className={inputClass} />
          </label>

          <p className="text-sm font-bold">Destinos</p>
          {origin.routes.map((route) => {
            const chosen = picked[route.route_id];
            return (
              <Card key={route.route_id} className={cn('p-3', chosen && 'ring-2 ring-primary')}>
                <button type="button" onClick={() => toggle(route)} className="flex w-full items-center justify-between text-left">
                  <span className="text-sm font-semibold">{origin.origin_city} → {route.destination_city}</span>
                  <span className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-md border',
                    chosen ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                  )}>
                    {chosen ? <Check size={14} /> : null}
                  </span>
                </button>
                {chosen ? (
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    <label className="text-xs text-muted-foreground">
                      Chegada
                      <input type="datetime-local" value={chosen.arrival} onChange={(event) => update(route.route_id, 'arrival', event.target.value)} className={inputClass} />
                    </label>
                    <label className="text-xs text-muted-foreground">
                      Preço (Kz)
                      <input type="number" min="1" inputMode="numeric" value={chosen.price} onChange={(event) => update(route.route_id, 'price', event.target.value)} className={inputClass} />
                    </label>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </>
      ) : null}

      {problem ? <p className="rounded-xl bg-danger/10 p-3 text-xs text-danger">{problem}</p> : null}

      <Button className="w-full" loading={saving} disabled={!newLegs.length || Boolean(problem)} onClick={save}>
        {newLegs.length ? `Adicionar ${newLegs.length} percurso(s)` : 'Escolha os destinos'}
      </Button>
    </div>
  );
}
