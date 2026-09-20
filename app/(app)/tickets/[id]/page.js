'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import {
  AlertCircle, ArrowRight, CalendarClock, Bus as BusIcon,
  Armchair, Wallet, RotateCcw, CalendarCog, ReceiptText, ShieldCheck, History,
} from 'lucide-react';
import BackButton from '@/components/BackButton';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Sheet from '@/components/ui/Sheet';
import Skeleton from '@/components/ui/Skeleton';
import TicketStatusBadge from '@/components/TicketStatusBadge';
import RescheduleSheet from '@/components/RescheduleSheet';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/ui/Toast';
import { formatDateTime, formatFullDateTime, formatKz, initials } from '@/lib/format';

const REVISION_LABELS = {
  purchase: 'Bilhete emitido',
  backfill: 'Registo histórico importado',
  ticket_rebook: 'Bilhete reprogramado',
  seat_change: 'Assento alterado',
  trip_schedule_change: 'Horário da viagem alterado',
  trip_bus_change: 'Autocarro da viagem alterado',
  trip_route_change: 'Rota da viagem alterada',
  trip_update: 'Dados da viagem alterados',
};

const ACCESS_LABELS = {
  authorized: 'Documento autorizado',
  blocked_refunded: 'Descarga bloqueada: reembolsado',
  blocked_cancelled: 'Descarga bloqueada: cancelado',
  blocked_unpaid: 'Descarga bloqueada: não pago',
};

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

export default function TicketDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const { data, loading, error, refetch } = useApi(`/api/tickets/${id}`);

  const [refundOpen, setRefundOpen] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  const doRefund = async () => {
    setRefunding(true);
    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refund' }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Falha ao reembolsar');
      toast('Bilhete reembolsado com sucesso.', 'success');
      setRefundOpen(false);
      refetch();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRefunding(false);
    }
  };

  if (loading && !data) {
    return (
      <div>
        <BackButton fallbackHref="/tickets" />
        <Skeleton className="h-28" />
        <Skeleton className="mt-3 h-56" />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <BackButton fallbackHref="/tickets" />
        <div className="flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          <AlertCircle size={16} />
          {error}
        </div>
      </div>
    );
  }

  const { ticket } = data;
  const itineraryHistory = data.itinerary_history || [];
  const documentAccesses = data.document_accesses || [];
  const originalItinerary = itineraryHistory[0] || null;
  const currentItinerary = itineraryHistory[itineraryHistory.length - 1] || null;
  const passengerName = ticket.passenger
    ? `${ticket.passenger.first_name || ''} ${ticket.passenger.last_name || ''}`.trim()
    : 'Passageiro';

  const canRefund = ['active', 'used'].includes(ticket.status) && ticket.payment_status === 'paid';
  // Agents reprogram on the Sunmi terminal; in NAWASOFT it is an admin action
  // and the API refuses anyone else.
  // An expired ticket (a no-show) is precisely the one that needs reprogramming
  // — that is how the passenger pays the multa and gets back onto a bus.
  const canReschedule =
    ['active', 'expired'].includes(ticket.status)
    && ticket.payment_status === 'paid'
    && data?.viewer_role === 'admin';

  return (
    <div>
      <BackButton fallbackHref="/tickets" />

      <div className="mb-4 flex items-center gap-3.5">
        <span className="sunset-gradient flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-black text-white">
          {initials(ticket.passenger?.first_name, ticket.passenger?.last_name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-extrabold">{passengerName}</p>
          <p className="text-sm text-muted-foreground">{ticket.passenger?.phone_number || '—'}</p>
        </div>
        <TicketStatusBadge status={ticket.status} />
      </div>

      <Card className="p-4">
        <div className="mb-1 flex items-center gap-1.5 text-sm font-bold">
          <span>{ticket.trip?.route?.origin_city}</span>
          <ArrowRight size={13} className="text-muted-foreground" />
          <span>{ticket.trip?.route?.destination_city}</span>
        </div>
        <p className="mb-1 text-xs text-muted-foreground">{ticket.ticket_number}</p>
        <div className="divide-y divide-border">
          <InfoRow icon={CalendarClock} label="Partida atual" value={formatDateTime(currentItinerary?.departure_time || ticket.trip?.departure_time)} />
          <InfoRow icon={CalendarClock} label="Comprado em" value={formatFullDateTime(ticket.booking_time || ticket.created_at)} />
          <InfoRow icon={BusIcon} label="Autocarro" value={`${currentItinerary?.bus_license_plate || ticket.trip?.bus?.license_plate} · ${currentItinerary?.bus_make || ticket.trip?.bus?.make || ''}`} />
          <InfoRow icon={Armchair} label="Assento" value={currentItinerary?.seat_number || ticket.seat_number} />
          <InfoRow
            icon={Wallet}
            label="Pagamento"
            value={`${formatKz(ticket.price_paid_usd)} · ${ticket.payment_method || '—'} · ${ticket.payment_status}`}
          />
        </div>
      </Card>

      <p className="mb-2 mt-5 text-sm font-bold text-muted-foreground">Prova da emissão</p>
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600">
            <ShieldCheck size={17} />
          </span>
          <div>
            <p className="text-sm font-bold">Itinerário preservado</p>
            <p className="text-xs text-muted-foreground">Registos append-only da base de dados</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-muted p-3">
            <p className="text-[11px] text-muted-foreground">Partida registada inicialmente</p>
            <p className="mt-1 font-semibold">{formatFullDateTime(originalItinerary?.departure_time)}</p>
          </div>
          <div className="rounded-xl bg-muted p-3">
            <p className="text-[11px] text-muted-foreground">Partida válida atualmente</p>
            <p className="mt-1 font-semibold">{formatFullDateTime(currentItinerary?.departure_time || ticket.trip?.departure_time)}</p>
          </div>
        </div>
        {originalItinerary?.is_historical_backfill ? (
          <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
            Bilhete anterior ao novo sistema de auditoria. Este primeiro registo foi importado do horário que estava na base de dados durante a migração; alterações anteriores não podem ser comprovadas.
          </div>
        ) : null}
      </Card>

      {itineraryHistory.length ? (
        <>
          <p className="mb-2 mt-5 text-sm font-bold text-muted-foreground">Histórico do itinerário</p>
          <div className="flex flex-col gap-2">
            {itineraryHistory.map((revision) => (
              <Card key={revision.id} className="flex items-start gap-3 p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <History size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{REVISION_LABELS[revision.event_type] || revision.event_type}</p>
                  <p className="text-xs text-muted-foreground">
                    {revision.origin_city} → {revision.destination_city} · {formatFullDateTime(revision.departure_time)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Lugar {revision.seat_number} · {revision.bus_license_plate} · registado {formatFullDateTime(revision.recorded_at)}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {documentAccesses.length ? (
        <>
          <p className="mb-2 mt-5 text-sm font-bold text-muted-foreground">Acessos ao PDF</p>
          <Card className="divide-y divide-border px-4">
            {documentAccesses.map((access) => (
              <div key={access.id} className="flex items-center justify-between gap-3 py-3">
                <p className="text-sm font-semibold">{ACCESS_LABELS[access.outcome] || access.outcome}</p>
                <p className="shrink-0 text-xs text-muted-foreground">{formatFullDateTime(access.requested_at)}</p>
              </div>
            ))}
          </Card>
        </>
      ) : null}

      {ticket.rebooking_fees?.length ? (
        <>
          <p className="mb-2 mt-5 text-sm font-bold text-muted-foreground">Histórico de multas</p>
          <div className="flex flex-col gap-2">
            {ticket.rebooking_fees.map((fee) => (
              <Card key={fee.id} className="flex items-center gap-3 p-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning/25 text-warning-foreground">
                  <ReceiptText size={15} />
                </span>
                <div className="flex-1">
                  <p className="text-sm font-semibold">Multa {fee.percentage}%</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(fee.collected_at)} · {fee.payment_method}</p>
                </div>
                <span className="text-sm font-bold">{formatKz(fee.amount_kz)}</span>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {(canRefund || canReschedule) ? (
        <div className="mt-6 flex gap-2.5 pb-2">
          {canReschedule ? (
            <Button variant="secondary" className="flex-1" onClick={() => setRescheduleOpen(true)}>
              <CalendarCog size={16} />
              Reprogramar
            </Button>
          ) : null}
          {canRefund ? (
            <Button variant="danger" className="flex-1" onClick={() => setRefundOpen(true)}>
              <RotateCcw size={16} />
              Reembolsar
            </Button>
          ) : null}
        </div>
      ) : null}

      <Sheet open={refundOpen} onClose={() => setRefundOpen(false)} title="Confirmar reembolso">
        <p className="pb-2 text-sm text-muted-foreground">
          O bilhete <strong>{ticket.ticket_number}</strong> será marcado como reembolsado e o assento{' '}
          <strong>{ticket.seat_number}</strong> ficará livre para venda. Esta ação não pode ser desfeita aqui.
        </p>
        <div className="mt-3 flex gap-2 pb-6">
          <Button variant="secondary" className="flex-1" onClick={() => setRefundOpen(false)}>
            Cancelar
          </Button>
          <Button variant="danger" className="flex-1" loading={refunding} onClick={doRefund}>
            Confirmar reembolso
          </Button>
        </div>
      </Sheet>

      <RescheduleSheet
        open={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
        ticket={ticket}
        onSuccess={(body) => {
          setRescheduleOpen(false);
          toast(body.message || 'Bilhete reprogramado.', 'success');
          refetch();
        }}
      />
    </div>
  );
}
