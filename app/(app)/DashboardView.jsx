'use client';

import { RefreshCw, TicketCheck, Bus as BusIcon, AlertCircle } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import FleetCard from '@/components/FleetCard';
import { SkeletonList } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useApi } from '@/lib/useApi';
import { formatDate } from '@/lib/format';
import { groupByOriginProvince } from '@/lib/origin-groups';
import OriginProvinceSection from '@/components/OriginProvinceSection';

export default function DashboardView({ initialData = null }) {
  // Seeded from the server render, so the fleet board is on screen in the
  // first paint. Refetching only happens when staff tap refresh.
  const { data, loading, error, refetch } = useApi('/api/dashboard', { initialData });
  const provinceGroups = groupByOriginProvince(data?.fleet || [], (entry) => entry.run);

  return (
    <div>
      <PageHeader
        title="Início"
        subtitle={data?.date ? formatDate(`${data.date}T12:00:00+01:00`) : 'A carregar…'}
        action={
          <button
            onClick={refetch}
            className="press-scale flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground"
            aria-label="Atualizar"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      {data ? (
        <div className="sunset-gradient animate-rise-in mb-5 grid grid-cols-2 gap-3 rounded-2xl p-4 text-white card-shadow">
          <div>
            <div className="flex items-center gap-1.5 text-white/85">
              <TicketCheck size={14} />
              <span className="text-[11px] font-semibold uppercase tracking-wide">Bilhetes vendidos hoje</span>
            </div>
            <p className="mt-1 text-2xl font-black">{data.totals.sold}</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-white/85">
              <BusIcon size={14} />
              <span className="text-[11px] font-semibold uppercase tracking-wide">Autocarros em serviço</span>
            </div>
            <p className="mt-1 text-2xl font-black">
              {data.totals.busesInService}<span className="text-base font-semibold text-white/75">/{data.fleetSize}</span>
            </p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          <AlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <SkeletonList count={5} />
      ) : data && data.fleet.length ? (
        <div className="flex flex-col gap-5">
          {provinceGroups.map((group) => (
            <OriginProvinceSection key={group.province} province={group.province} count={group.entries.length}>
              {group.entries.map((entry, index) => (
                <FleetCard key={entry.bus.id} entry={entry} index={index} />
              ))}
            </OriginProvinceSection>
          ))}
        </div>
      ) : data ? (
        <EmptyState icon={BusIcon} title="Nenhum autocarro ativo" description="Ative autocarros para os ver aqui." />
      ) : null}
    </div>
  );
}
