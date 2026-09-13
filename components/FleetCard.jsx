'use client';

import Link from 'next/link';
import { ChevronRight, Bus as BusIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import CapacityBar from '@/components/CapacityBar';
import { formatTime } from '@/lib/format';

export default function FleetCard({ entry, index = 0 }) {
  const { bus, run, sold, capacity, remaining } = entry;

  return (
    <div className="animate-rise-in" style={{ animationDelay: `${Math.min(index * 50, 300)}ms` }}>
      <Link href={`/buses/${bus.id}`}>
        <Card className="press-scale flex items-center gap-3.5 p-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <BusIcon size={22} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-bold">{bus.make} · {bus.license_plate}</p>
              {run ? (
                <span className="whitespace-nowrap text-sm font-black text-primary">
                  {sold}/{capacity}
                </span>
              ) : (
                <Badge tone="neutral">Sem viagem</Badge>
              )}
            </div>

            {run ? (
              <>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {/* Several legs can share a pickup city (Benguela→Luanda,
                      Benguela→Sumbe…), so list each terminal only once. */}
                  {[...new Set(run.origins.map((o) => o.origin_city))].join(' + ')} → {[...new Set(run.origins.map((o) => o.destination_city))].join(' / ')} · {formatTime(run.departure_time)}
                </p>
                <CapacityBar sold={sold} capacity={capacity} className="mt-2.5" />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {remaining > 0 ? `${remaining} lugares livres` : 'Esgotado'}
                </p>
              </>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">Nenhuma partida agendada hoje</p>
            )}
          </div>

          <ChevronRight size={18} className="shrink-0 text-muted-foreground" />
        </Card>
      </Link>
    </div>
  );
}
