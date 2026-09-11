'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowRight, AlertCircle, MapPinned, Clock } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { Card } from '@/components/ui/Card';
import CapacityBar from '@/components/CapacityBar';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useApi } from '@/lib/useApi';
import { formatTime, formatKz } from '@/lib/format';

export default function RouteDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data, loading, error } = useApi(`/api/routes/${id}`);

  if (loading && !data) {
    return (
      <div>
        <BackButton fallbackHref="/routes" />
        <Skeleton className="h-24" />
        <Skeleton className="mt-3 h-40" />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <BackButton fallbackHref="/routes" />
        <div className="flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          <AlertCircle size={16} />
          {error}
        </div>
      </div>
    );
  }

  const { route, departures } = data;

  return (
    <div>
      <BackButton fallbackHref="/routes" />

      <div className="mb-5 flex items-center gap-2.5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
          <MapPinned size={22} />
        </span>
        <div>
          <div className="flex items-center gap-1.5 text-lg font-extrabold leading-tight">
            <span>{route.origin_city}</span>
            <ArrowRight size={15} className="text-muted-foreground" />
            <span>{route.destination_city}</span>
          </div>
          <p className="text-sm text-muted-foreground">{route.destination_province} · {formatKz(route.base_price_usd)}</p>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3">
        <Card className="p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Distância</p>
          <p className="mt-1 text-lg font-bold">{route.distance_km ? `${route.distance_km} km` : '—'}</p>
        </Card>
        <Card className="p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Duração</p>
          <p className="mt-1 text-lg font-bold">{route.estimated_duration_hours ? `${route.estimated_duration_hours}h` : '—'}</p>
        </Card>
      </div>

      <p className="mb-2 text-sm font-bold text-muted-foreground">Partidas de hoje</p>
      {departures.length ? (
        <div className="flex flex-col gap-2.5">
          {departures.map((d) => (
            <Card
              key={d.trip_id}
              className="press-scale cursor-pointer p-3.5"
              onClick={() => router.push(`/trips/${d.trip_id}`)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Clock size={14} className="text-muted-foreground" />
                  {formatTime(d.departure_time)}
                  <span className="font-normal text-muted-foreground">· {d.bus?.license_plate}</span>
                </div>
                <span className="text-sm font-black text-primary">{d.sold}/{d.capacity}</span>
              </div>
              <CapacityBar sold={d.sold} capacity={d.capacity} className="mt-2.5" />
              {/* The bar is the whole bus, which also carries passengers
                  boarding at other terminals; call out this route's share. */}
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {d.leg_sold} nesta rota · {d.remaining > 0 ? `${d.remaining} lugares livres no autocarro` : 'Autocarro esgotado'}
              </p>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={Clock} title="Sem partidas hoje" description="Esta rota não tem viagens agendadas para hoje." />
      )}
    </div>
  );
}
