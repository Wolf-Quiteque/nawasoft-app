'use client';

import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { MapPin, AlertCircle, Bus as BusIcon } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import CapacityBar from '@/components/CapacityBar';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useApi } from '@/lib/useApi';
import { formatTime } from '@/lib/format';

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
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="sunset-gradient p-5 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/80">Partida de hoje</p>
                <p className="text-lg font-bold">{formatTime(today.departure_time)}</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-black leading-none">{today.sold}<span className="text-lg font-semibold text-white/75">/{today.capacity}</span></p>
                <p className="text-[11px] text-white/80">bilhetes vendidos</p>
              </div>
            </div>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-white transition-[width] duration-500" style={{ width: `${today.capacity > 0 ? Math.min(100, (today.sold / today.capacity) * 100) : 0}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-white/85">{today.remaining} lugares livres</p>
          </Card>

          <p className="mb-2 mt-5 text-sm font-bold text-muted-foreground">Passageiros por origem</p>
          <div className="flex flex-col gap-2.5">
            {today.origins.map((o) => (
              <Card key={o.trip_id} className="flex items-center gap-3 p-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/25 text-accent-foreground">
                  <MapPin size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{o.origin_city}</p>
                  <p className="truncate text-xs text-muted-foreground">→ {o.destination_city}</p>
                </div>
                <Badge tone="primary">{o.sold} {o.sold === 1 ? 'passageiro' : 'passageiros'}</Badge>
              </Card>
            ))}
          </div>
        </motion.div>
      ) : (
        <EmptyState icon={BusIcon} title="Sem viagem hoje" description="Este autocarro não tem partidas agendadas para hoje." />
      )}

      {data.upcoming?.length ? (
        <>
          <p className="mb-2 mt-6 text-sm font-bold text-muted-foreground">Próximas partidas</p>
          <div className="flex flex-col gap-2.5">
            {data.upcoming.map((run) => (
              <Card key={run.departure_time} className="flex items-center justify-between p-3.5">
                <div>
                  <p className="text-sm font-semibold">{formatTime(run.departure_time)}</p>
                  <p className="text-xs text-muted-foreground">{run.origins.map((o) => o.origin_city).join(' + ')}</p>
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
