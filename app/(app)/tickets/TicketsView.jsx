'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search, AlertCircle, Ticket as TicketIcon, ArrowRight, Download } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import Input from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import TicketStatusBadge from '@/components/TicketStatusBadge';
import { SkeletonList } from '@/components/ui/Skeleton';
import { ticketDownloadUrl } from '@/lib/ticket-download';
import EmptyState from '@/components/ui/EmptyState';
import { useApi } from '@/lib/useApi';
import { useDebounce } from '@/lib/useDebounce';
import { cn } from '@/lib/cn';
import { formatDateTime, formatKz } from '@/lib/format';

const FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'active', label: 'Ativos' },
  { value: 'used', label: 'Usados' },
  { value: 'refunded', label: 'Reembolsados' },
];

export default function TicketsView({ initialData = null }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const debouncedSearch = useDebounce(search);

  const params = new URLSearchParams();
  if (debouncedSearch) params.set('search', debouncedSearch);
  if (status) params.set('status', status);

  // The unfiltered first page is server-rendered; typing or filtering fetches.
  const { data, loading, error } = useApi(`/api/tickets?${params.toString()}`, { initialData });

  return (
    <div>
      <PageHeader title="Bilhetes" subtitle="Pesquisar e gerir bilhetes" />

      <Input
        icon={<Search size={16} />}
        placeholder="Nome, telefone, referência ou nº bilhete"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatus(f.value)}
            className={cn(
              'press-scale shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold',
              status === f.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface text-muted-foreground'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          <AlertCircle size={16} />
          {error}
        </div>
      ) : null}

      <div className="mt-4">
        {loading && !data ? (
          <SkeletonList count={5} itemClassName="h-20" />
        ) : data?.tickets?.length ? (
          <div className="flex flex-col gap-2.5">
            {data.tickets.map((t, i) => (
              <div
                key={t.id}
                className="animate-rise-in"
                style={{ animationDelay: `${Math.min(i * 30, 240)}ms` }}
              >
                <Link href={`/tickets/${t.id}`}>
                  <Card className="press-scale p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">
                          {t.passenger ? `${t.passenger.first_name || ''} ${t.passenger.last_name || ''}`.trim() : 'Passageiro'}
                        </p>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="truncate">{t.trip?.route?.origin_city}</span>
                          <ArrowRight size={10} className="shrink-0" />
                          <span className="truncate">{t.trip?.route?.destination_city}</span>
                          <span>· Assento {t.seat_number}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">{t.ticket_number} · {formatDateTime(t.trip?.departure_time)}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <TicketStatusBadge status={t.status} />
                        <span className="text-xs font-semibold">{formatKz(t.price_paid_usd)}</span>
                        {t.payment_reference && t.payment_status === 'paid' ? (
                          // Straight to the passenger's PDF, without opening the
                          // ticket first — the usual reason for searching.
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              window.open(ticketDownloadUrl(t.payment_reference), '_blank', 'noopener');
                            }}
                            className="press-scale mt-0.5 flex items-center gap-1 rounded-lg bg-primary/12 px-2 py-1 text-[11px] font-semibold text-primary"
                            aria-label="Abrir bilhete em PDF"
                          >
                            <Download size={12} />
                            Bilhete
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </Card>
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={TicketIcon}
            title="Nenhum bilhete encontrado"
            description={debouncedSearch ? 'Tente outro nome, telefone ou número.' : 'Ajuste os filtros ou pesquise por um bilhete.'}
          />
        )}
      </div>
    </div>
  );
}
