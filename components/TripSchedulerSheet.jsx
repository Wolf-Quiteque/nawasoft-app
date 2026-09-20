'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Plus, Trash2 } from 'lucide-react';
import Sheet from '@/components/ui/Sheet';
import Button from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { todayInLuanda, formatDateTime } from '@/lib/format';

const DAYS = [{ n: 1, s: 'Seg' }, { n: 2, s: 'Ter' }, { n: 3, s: 'Qua' }, { n: 4, s: 'Qui' }, { n: 5, s: 'Sex' }, { n: 6, s: 'Sáb' }, { n: 0, s: 'Dom' }];
const blankLeg = (stableKey = null) => ({ key: stableKey || crypto.randomUUID(), route_id: '', departure_time: '18:00', duration_hours: '10', price_kz: '', online_price_kz: '' });
const fmtKz = (value) => Number(value || 0).toLocaleString('pt-AO');

function addCalendarMonths(date, months) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
}

function LegEditor({ title, legs, setLegs, routes, canPrice }) {
  const patchLeg = (key, values) => setLegs((items) => items.map((item) => item.key === key ? { ...item, ...values } : item));
  // Shown as the placeholder so it is clear what a blank field will charge.
  const basePriceOf = (routeId) => {
    const route = routes.find((item) => item.id === routeId);
    return route ? fmtKz(route.base_price_usd) : 'preço base';
  };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between"><p className="text-sm font-bold">{title}</p><button type="button" className="flex items-center gap-1 text-xs font-semibold text-primary" onClick={() => setLegs((items) => [...items, blankLeg()])}><Plus size={13} /> Rota</button></div>
      <div className="space-y-2">
        {legs.map((leg) => (
          <Card key={leg.key} className="p-3">
            <div className="flex gap-2">
              <select value={leg.route_id} onChange={(event) => patchLeg(leg.key, { route_id: event.target.value })} className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-2 text-sm">
                <option value="">Selecionar rota</option>
                {routes.map((route) => <option key={route.id} value={route.id}>{route.origin_city} → {route.destination_city}</option>)}
              </select>
              {legs.length > 1 ? <button type="button" aria-label="Remover rota" className="flex h-11 w-10 items-center justify-center rounded-xl bg-danger/10 text-danger" onClick={() => setLegs((items) => items.filter((item) => item.key !== leg.key))}><Trash2 size={16} /></button> : null}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-[11px] text-muted-foreground">Partida<input type="time" value={leg.departure_time} onChange={(event) => patchLeg(leg.key, { departure_time: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-2 text-sm" /></label>
              <label className="text-[11px] text-muted-foreground">Duração (horas)<input type="number" min="0.25" step="0.25" value={leg.duration_hours} onChange={(event) => patchLeg(leg.key, { duration_hours: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-2 text-sm" /></label>
            </div>
            {canPrice ? <><div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-[11px] text-muted-foreground">Preço balcão / Sunmi (Kz)<input type="number" min="0" step="100" value={leg.price_kz} placeholder={basePriceOf(leg.route_id)} onChange={(event) => patchLeg(leg.key, { price_kz: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-2 text-sm" /></label>
              <label className="text-[11px] text-muted-foreground">Preço online (Kz)<input type="number" min="0" step="100" value={leg.online_price_kz} placeholder={leg.price_kz ? fmtKz(leg.price_kz) : basePriceOf(leg.route_id)} onChange={(event) => patchLeg(leg.key, { online_price_kz: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-2 text-sm" /></label>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">Em branco usa o preço base da rota. O preço online só difere se o escrever.</p></> : null}
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function TripSchedulerSheet({ open, onClose, onScheduled, toast }) {
  const today = todayInLuanda();
  const [options, setOptions] = useState(null);
  const [companyId, setCompanyId] = useState('');
  const [busId, setBusId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addCalendarMonths(today, 1));
  const [mode, setMode] = useState('weekdays');
  const [weekdays, setWeekdays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [intervalDays, setIntervalDays] = useState(2);
  const [offsets, setOffsets] = useState({});
  const [legs, setLegs] = useState([blankLeg('outbound-0')]);
  const [roundTrip, setRoundTrip] = useState(false);
  const [returnDayOffset, setReturnDayOffset] = useState(1);
  const [returnLegs, setReturnLegs] = useState([blankLeg('return-0')]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    fetch('/api/trip-schedules', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Falha ao carregar dados.');
        setOptions(body);
        setCompanyId(body.default_company_id || '');
      })
      .catch((error) => toast(error.message, 'error'));
  }, [open, toast]);

  const buses = useMemo(() => (options?.buses || []).filter((item) => !companyId || item.company_id === companyId), [options, companyId]);
  const drivers = useMemo(() => (options?.drivers || []).filter((item) => !companyId || !item.company_id || item.company_id === companyId), [options, companyId]);
  const routes = useMemo(() => (options?.routes || []).filter((item) => !companyId || item.company_id === companyId), [options, companyId]);

  const legPayload = (leg) => ({
    route_id: leg.route_id,
    departure_time: leg.departure_time,
    duration_minutes: Math.round(Number(leg.duration_hours) * 60),
    price_kz: leg.price_kz === '' ? null : Number(leg.price_kz),
    online_price_kz: leg.online_price_kz === '' ? null : Number(leg.online_price_kz),
  });

  // Only an admin may charge something other than the route's base price.
  const canPrice = options?.viewer_role === 'admin';

  const payload = (dryRun) => ({
    company_id: companyId, bus_id: busId, driver_id: driverId, start_date: startDate, end_date: endDate,
    recurrence_mode: mode, weekdays, interval_days: Number(intervalDays),
    weekday_offsets: Object.fromEntries(Object.entries(offsets).map(([day, hours]) => [day, Math.round(Number(hours || 0) * 60)])),
    seat_class: 'economy', is_campaign: false, round_trip: roundTrip, return_day_offset: Number(returnDayOffset), dry_run: dryRun,
    legs: legs.map(legPayload),
    return_legs: roundTrip ? returnLegs.map(legPayload) : [],
  });

  const submit = async (dryRun) => {
    setBusy(true);
    try {
      const response = await fetch('/api/trip-schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(dryRun)) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Não foi possível programar as viagens.');
      if (dryRun) {
        setPreview({ ...body, signature: JSON.stringify(payload(false)) });
        toast('Pré-visualização validada.', 'success');
      } else {
        toast(`${body.created} percurso(s) programado(s).`, 'success');
        onScheduled?.(body);
        onClose();
      }
    } catch (error) {
      setPreview(null);
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Programar viagens" maxHeight="94vh">
      <div className="space-y-4 pb-6">
        <p className="text-sm text-muted-foreground">Crie uma saída única ou uma programação semanal/mensal. Veja a tabela e os conflitos antes de confirmar.</p>
        {(options?.companies || []).length > 1 ? <select value={companyId} onChange={(event) => { setCompanyId(event.target.value); setBusId(''); setDriverId(''); }} className="h-12 w-full rounded-2xl border border-border bg-surface px-3 text-sm"><option value="">Empresa</option>{options.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : null}
        <div className="grid grid-cols-2 gap-2">
          <select value={busId} onChange={(event) => setBusId(event.target.value)} className="h-12 min-w-0 rounded-2xl border border-border bg-surface px-2 text-sm"><option value="">Autocarro</option>{buses.map((item) => <option key={item.id} value={item.id}>{item.license_plate} · {item.capacity - 1}</option>)}</select>
          <select value={driverId} onChange={(event) => setDriverId(event.target.value)} className="h-12 min-w-0 rounded-2xl border border-border bg-surface px-2 text-sm"><option value="">Motorista</option>{drivers.map((item) => <option key={item.id} value={item.id}>{item.first_name} {item.last_name}</option>)}</select>
        </div>
        <div className="grid grid-cols-2 gap-2"><label className="text-xs text-muted-foreground">Início<input type="date" value={startDate} min={today} onChange={(event) => setStartDate(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-surface px-2 text-sm" /></label><label className="text-xs text-muted-foreground">Fim<input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-surface px-2 text-sm" /></label></div>

        <div>
          <p className="mb-2 text-sm font-bold">Repetição</p>
          <div className="grid grid-cols-2 gap-2"><button className={`h-10 rounded-xl border text-sm font-semibold ${mode === 'weekdays' ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`} onClick={() => setMode('weekdays')}>Semanal</button><button className={`h-10 rounded-xl border text-sm font-semibold ${mode === 'interval' ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`} onClick={() => setMode('interval')}>A cada N dias</button></div>
          {mode === 'weekdays' ? <div className="mt-2 grid grid-cols-7 gap-1">{DAYS.map((day) => <button key={day.n} onClick={() => setWeekdays((items) => items.includes(day.n) ? items.filter((item) => item !== day.n) : [...items, day.n])} className={`h-9 rounded-lg text-[11px] font-bold ${weekdays.includes(day.n) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{day.s}</button>)}</div> : <label className="mt-2 block text-xs text-muted-foreground">Intervalo em dias<input type="number" min="1" max="30" value={intervalDays} onChange={(event) => setIntervalDays(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm" /></label>}
          <details className="mt-2 rounded-xl bg-muted p-3"><summary className="cursor-pointer text-xs font-semibold">Horário especial por dia</summary><p className="mt-1 text-[11px] text-muted-foreground">Use -1 para sair uma hora antes, por exemplo aos domingos.</p><div className="mt-2 grid grid-cols-4 gap-2">{DAYS.map((day) => <label key={day.n} className="text-[10px] text-muted-foreground">{day.s}<input type="number" step="0.5" value={offsets[day.n] ?? 0} onChange={(event) => setOffsets((value) => ({ ...value, [day.n]: event.target.value }))} className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs" /></label>)}</div></details>
        </div>

        <LegEditor title="Percursos de ida — mesmo autocarro" legs={legs} setLegs={setLegs} routes={routes} canPrice={canPrice} />
        <label className="flex items-center gap-2 rounded-xl bg-muted p-3 text-sm font-semibold"><input type="checkbox" checked={roundTrip} onChange={(event) => setRoundTrip(event.target.checked)} /> Programar regresso no mesmo autocarro</label>
        {roundTrip ? <><label className="block text-xs text-muted-foreground">O regresso começa quantos dias depois?<input type="number" min="0" max="7" value={returnDayOffset} onChange={(event) => setReturnDayOffset(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm" /></label><LegEditor title="Percursos de regresso" legs={returnLegs} setLegs={setReturnLegs} routes={routes} canPrice={canPrice} /></> : null}

        {preview ? <Card className="p-3"><div className="mb-2 flex items-center gap-2"><CalendarPlus size={16} className="text-success" /><p className="text-sm font-bold">{preview.total} percursos · {preview.created} novos · {preview.skipped} existentes</p></div><div className="max-h-52 overflow-auto rounded-xl border border-border"><table className="w-full text-left text-[11px]"><thead className="sticky top-0 bg-muted"><tr><th className="p-2">Dia</th><th className="p-2">Viagem</th><th className="p-2">Partida</th><th className="p-2">Preço</th></tr></thead><tbody>{preview.preview?.map((row, index) => <tr key={`${row.departure_time}-${index}`} className="border-t border-border"><td className="p-2">{row.date}</td><td className="p-2">{row.direction}<br />{row.route}</td><td className="p-2">{formatDateTime(row.departure_time)}</td><td className="p-2">{fmtKz(row.price_usd)}{row.online_price_kz != null && Number(row.online_price_kz) !== Number(row.price_usd) ? <><br /><span className="text-muted-foreground">online {fmtKz(row.online_price_kz)}</span></> : null}</td></tr>)}</tbody></table></div></Card> : null}

        <div className="grid grid-cols-2 gap-2"><Button variant="secondary" loading={busy} disabled={!companyId || !busId || !driverId} onClick={() => submit(true)}>Pré-visualizar</Button><Button loading={busy} disabled={!preview?.valid || preview.signature !== JSON.stringify(payload(false))} onClick={() => submit(false)}>Criar viagens</Button></div>
      </div>
    </Sheet>
  );
}
