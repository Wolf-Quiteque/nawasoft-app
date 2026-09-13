'use client';

import { useParams } from 'next/navigation';
import { MapPin, AlertCircle, Bus as BusIcon } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useApi } from '@/lib/useApi';
import { formatDate, formatTime } from '@/lib/format';

function luandaDay(dateString) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Luanda' }).format(new Date(dateString));
}

function uniqueJoin(values, separator) {
  return [...new Set(values.filter(Boolean))].join(separator);
}

export default function BusDetailPage() {
  const { busId } = useParams();
  const { data, loading, error } = useApi(`/api/buses/${busId}`);

  if (loading && !data) {
    return (
      <div>
        <BackButton fallbackHref="/" />
        <Skeleton className="h-28" />
        <Skeleton className="mt-3 h-40" />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <BackButton fallbackHref="/" />
        <div className="flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          <AlertCircle size={16} />
          {error}
        </div>
      </div>
    );
  }

  const { bus, today } = data;
  const isToday = today.departure_time && luandaDay(today.departure_time) === data.date;
  const byOrigin = today.by_origin || [];

  return (
    <div>
      <BackButton fallbackHref="/" />

      <div className="mb-5 flex items-center gap-3.5">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary">
          <BusIcon size={26} />
        </div>
        <div>
          <h1 className="text-xl font-extrabold leading-tight">{bus.make} {bus.model}</h1>
          <p className="text-sm text-muted-foreground">{bus.license_plate} · {bus.capacity} lugares (inc. copiloto)</p>
        </div>
      </div>

      {today.departure_time ? (
        <div className="animate-rise-in">
          <Card className="sunset-gradient p-5 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/80">
                  {isToday ? 'Partida de hoje' : `Próxima partida · ${formatDate(today.departure_time)}`}
                </p>
                <p className="text-lg font-bold">{formatTime(today.departure_time)}</p>
                <p className="text-[11px] text-white/80">
                  {uniqueJoin(byOrigin.map((o) => o.origin_city), ' + ')}
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-black leading-none">{today.sold}<span className="text-lg font-semibold text-white/75">/{today.capacity}</span></p>
                <p className="text-[11px] text-white/80">bilhetes vendidos</p>
              </div>
            </div>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-white transition-[width] duration-500" style={{ width: `${today.capacity > 0 ? Math.min(100, (today.sold / today.capacity) * 100) : 0}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-white/85">
              {today.remaining > 0 ? `${today.remaining} lugares livres` : 'Esgotado'}
            </p>
          </Card>

          <p className="mb-2 mt-5 text-sm font-bold text-muted-foreground">Passageiros por origem</p>
          <div className="flex flex-col gap-2.5">
            {byOrigin.map((o) => (
              <Card key={o.origin_city} className="p-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/25 text-accent-foreground">
                    <MapPin size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{o.origin_city}</p>
                    <p className="truncate text-xs text-muted-foreground">Embarque às {formatTime(o.departure_time)}</p>
                  </div>
                  <Badge tone="primary">{o.sold} {o.sold === 1 ? 'passageiro' : 'passageiros'}</Badge>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5 pl-12">
                  {o.destinations.map((d) => (
                    <span key={d.trip_id} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      → {d.destination_city}: <span className="font-semibold text-foreground">{d.sold}</span>
                    </span>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState icon={BusIcon} title="Sem viagem hoje" description="Este autocarro não tem partidas agendadas para hoje." />
      )}

      {data.upcoming?.length ? (
        <>
          <p className="mb-2 mt-6 text-sm font-bold text-muted-foreground">Próximas partidas</p>
          <div className="flex flex-col gap-2.5">
            {data.upcoming.map((run) => (
              <Card key={run.departure_time} className="flex items-center justify-between p-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{formatDate(run.departure_time)} · {formatTime(run.departure_time)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {uniqueJoin(run.origins.map((o) => o.origin_city), ' + ')} → {uniqueJoin(run.origins.map((o) => o.destination_city), ' / ')}
                  </p>
                </div>
                <Badge tone="neutral">{run.sold}/{run.capacity}</Badge>
              </Card>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
