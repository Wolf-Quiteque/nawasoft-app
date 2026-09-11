'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import {
  AlertCircle, ArrowRight, CalendarClock, Bus as BusIcon,
  Armchair, Wallet, RotateCcw, CalendarCog, ReceiptText,
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
import { formatDateTime, formatKz, initials } from '@/lib/format';

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
  const passengerName = ticket.passenger
    ? `${ticket.passenger.first_name || ''} ${ticket.passenger.last_name || ''}`.trim()
    : 'Passageiro';

  const canRefund = ['active', 'used'].includes(ticket.status) && ticket.payment_status === 'paid';
  const canReschedule = ticket.status === 'active' && ticket.payment_status === 'paid';

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
          <InfoRow icon={CalendarClock} label="Partida" value={formatDateTime(ticket.trip?.departure_time)} />
          <InfoRow icon={BusIcon} label="Autocarro" value={`${ticket.trip?.bus?.license_plate} · ${ticket.trip?.bus?.make || ''}`} />
          <InfoRow icon={Armchair} label="Assento" value={ticket.seat_number} />
          <InfoRow
            icon={Wallet}
            label="Pagamento"
            value={`${formatKz(ticket.price_paid_usd)} · ${ticket.payment_method || '—'} · ${ticket.payment_status}`}
          />
        </div>
      </Card>

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
