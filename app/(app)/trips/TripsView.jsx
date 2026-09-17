'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Bus as BusIcon, User, ArrowRight, Plus } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import DateNav from '@/components/DateNav';
import { Card } from '@/components/ui/Card';
import CapacityBar from '@/components/CapacityBar';
import { SkeletonList } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useApi } from '@/lib/useApi';
import { formatTime } from '@/lib/format';
import Button from '@/components/ui/Button';
import TripSchedulerSheet from '@/components/TripSchedulerSheet';
import { useToast } from '@/components/ui/Toast';

export default function TripsView({ initialDate, initialData = null }) {
  const [date, setDate] = useState(initialDate);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  // Today's departures come from the server render; changing the date fetches.
  const { data, loading, error, refetch } = useApi(`/api/trips?date=${date}`, { initialData });

  return (
    <div>
      <PageHeader
        title="Viagens"
        subtitle="Partidas agrupadas por autocarro"
        action={<Button size="sm" onClick={() => setSchedulerOpen(true)}><Plus size={15} /> Programar</Button>}
      />
      <DateNav date={date} onChange={setDate} />

      {error ? (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          <AlertCircle size={16} />
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <SkeletonList count={4} itemClassName="h-28" />
      ) : data?.runs?.length ? (
        <div className="flex flex-col gap-3">
          {data.runs.map((run, i) => (
            <div
              key={run.key}
              className="animate-rise-in"
              style={{ animationDelay: `${Math.min(i * 40, 300)}ms` }}
            >
              <Card
                className="press-scale cursor-pointer p-4"
                onClick={() => router.push(`/trips/${run.legs[0].trip_id}`)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
                      <BusIcon size={17} />
                    </span>
                    <div>
                      <p className="text-sm font-bold">{run.bus?.license_plate}</p>
                      <p className="text-xs text-muted-foreground">{formatTime(run.departure_time)}</p>
                    </div>
                  </div>
                  <span className="text-sm font-black text-primary">{run.sold}/{run.capacity}</span>
                </div>

                {/* Legs often share a pickup city and differ only by
                    destination, so show each terminal once on either side. */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {[...new Set(run.legs.map((l) => l.origin_city))].map((city, li) => (
                    <span key={city} className="flex items-center gap-1.5">
                      {li > 0 ? <span className="text-border">+</span> : null}
                      <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground">{city}</span>
                    </span>
                  ))}
                  <ArrowRight size={11} />
                  <span className="font-medium text-foreground">
                    {[...new Set(run.legs.map((l) => l.destination_city))].join(' / ')}
                  </span>
                </div>

                <CapacityBar sold={run.sold} capacity={run.capacity} className="mt-3" />

                {run.driver ? (
                  <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <User size={12} />
                    {run.driver.first_name} {run.driver.last_name}
                  </div>
                ) : null}
              </Card>
            </div>
          ))}
        </div>
      ) : data ? (
        <EmptyState icon={BusIcon} title="Sem viagens" description="Não há partidas agendadas para este dia." />
      ) : null}

      <TripSchedulerSheet
        open={schedulerOpen}
        onClose={() => setSchedulerOpen(false)}
        toast={toast}
        onScheduled={() => refetch()}
      />
    </div>
  );
}
