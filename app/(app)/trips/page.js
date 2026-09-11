'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { AlertCircle, Bus as BusIcon, User, ArrowRight } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import DateNav from '@/components/DateNav';
import { Card } from '@/components/ui/Card';
import CapacityBar from '@/components/CapacityBar';
import { SkeletonList } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useApi } from '@/lib/useApi';
import { formatTime, todayInLuanda } from '@/lib/format';

export default function TripsPage() {
  const [date, setDate] = useState(todayInLuanda());
  const router = useRouter();
  const { data, loading, error } = useApi(`/api/trips?date=${date}`);

  return (
    <div>
      <PageHeader title="Viagens" subtitle="Partidas agrupadas por autocarro" />
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
            <motion.div key={run.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.3) }}>
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

                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {run.legs.map((leg, li) => (
                    <span key={leg.trip_id} className="flex items-center gap-1.5">
                      {li > 0 ? <span className="text-border">+</span> : null}
                      <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground">{leg.origin_city}</span>
                    </span>
                  ))}
                  <ArrowRight size={11} />
                  <span className="font-medium text-foreground">{run.legs[0]?.destination_city}</span>
                </div>

                <CapacityBar sold={run.sold} capacity={run.capacity} className="mt-3" />

                {run.driver ? (
                  <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <User size={12} />
                    {run.driver.first_name} {run.driver.last_name}
                  </div>
                ) : null}
              </Card>
            </motion.div>
          ))}
        </div>
      ) : data ? (
        <EmptyState icon={BusIcon} title="Sem viagens" description="Não há partidas agendadas para este dia." />
      ) : null}
    </div>
  );
}
