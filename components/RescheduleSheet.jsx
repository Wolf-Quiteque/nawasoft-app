'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, Clock, AlertCircle } from 'lucide-react';
import Sheet from '@/components/ui/Sheet';
import Button from '@/components/ui/Button';
import DateNav from '@/components/DateNav';
import SeatGrid from '@/components/SeatGrid';
import Skeleton from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatTime, formatKz, todayInLuanda } from '@/lib/format';
import { REBOOKING_FEE_PERCENT, rebookingFeeAmount } from '@/lib/rebooking-fee';

const FEE_METHODS = [
  { value: 'cash', label: 'Dinheiro' },
  { value: 'tpa', label: 'TPA' },
];

export default function RescheduleSheet({ open, onClose, ticket, onSuccess }) {
  const [step, setStep] = useState(1);
  const [date, setDate] = useState(todayInLuanda());
  const [options, setOptions] = useState(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [seatData, setSeatData] = useState(null);
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [applyFee, setApplyFee] = useState(false);
  const [feeMethod, setFeeMethod] = useState('cash');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setDate(todayInLuanda());
    setSelectedTrip(null);
    setSeatData(null);
    setSelectedSeat(null);
    setApplyFee(false);
    setFeeMethod('cash');
    setError(null);
  }, [open, ticket?.id]);

  useEffect(() => {
    if (!open || step !== 1) return;
    setLoadingOptions(true);
    fetch(`/api/tickets/${ticket.id}/reschedule-options?date=${date}`)
      .then((res) => res.json())
      .then((body) => setOptions(body))
      .catch(() => setOptions(null))
      .finally(() => setLoadingOptions(false));
  }, [open, step, date, ticket?.id]);

  const pickTrip = (trip) => {
    setSelectedTrip(trip);
    setStep(2);
    setLoadingSeats(true);
    fetch(`/api/trips/${trip.trip_id}/seats`)
      .then((res) => res.json())
      .then((body) => setSeatData(body))
      .catch(() => setSeatData(null))
      .finally(() => setLoadingSeats(false));
  };

  const feeAmount = rebookingFeeAmount(ticket?.price_paid_usd);

  const confirm = async () => {
    if (!selectedSeat) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          new_trip_id: selectedTrip.trip_id,
          new_seat_number: selectedSeat,
          apply_rebooking_fee: applyFee,
          rebooking_fee_payment_method: applyFee ? feeMethod : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Falha ao reprogramar bilhete');
      onSuccess(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={step === 1 ? 'Reprogramar viagem' : 'Escolher assento'} maxHeight="90vh">
      {step === 1 ? (
        <div className="pb-6">
          <DateNav date={date} onChange={setDate} />
          {loadingOptions ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : options?.options?.length ? (
            <div className="flex flex-col gap-2">
              {options.options.map((o) => (
                <button
                  key={o.trip_id}
                  disabled={o.remaining <= 0}
                  onClick={() => pickTrip(o)}
                  className={cn(
                    'press-scale flex items-center justify-between rounded-2xl border p-3.5 text-left disabled:opacity-50',
                    o.is_current ? 'border-primary bg-primary/8' : 'border-border bg-surface'
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
                      <Clock size={16} />
                    </span>
                    <div>
                      <p className="text-sm font-bold">{formatTime(o.departure_time)}</p>
                      <p className="text-xs text-muted-foreground">
                        {o.bus_plate} {o.is_current ? '· viagem atual' : ''}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {o.remaining > 0 ? `${o.remaining} livres` : 'Esgotado'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">Sem viagens nesta data.</p>
          )}
        </div>
      ) : (
        <div className="pb-6">
          <button onClick={() => setStep(1)} className="press-scale mb-3 flex items-center gap-1 text-sm font-semibold text-primary">
            <ChevronLeft size={16} /> Escolher outra viagem
          </button>

          {loadingSeats ? (
            <Skeleton className="h-64" />
          ) : seatData ? (
            <SeatGrid
              seats={seatData.seats.map((s) => (s.ticket?.id === ticket.id ? { ...s, state: 'available' } : s))}
              selectedSeat={selectedSeat}
              onSelectSeat={setSelectedSeat}
            />
          ) : null}

          <div className="mt-5 rounded-2xl border border-border bg-muted/50 p-3.5">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={applyFee}
                onChange={(e) => setApplyFee(e.target.checked)}
                className="mt-0.5 h-5 w-5 accent-[var(--color-primary)]"
              />
              <div>
                <p className="text-sm font-semibold">Cobrar multa de {REBOOKING_FEE_PERCENT}%</p>
                <p className="text-xs text-muted-foreground">
                  Valor original: {formatKz(ticket?.price_paid_usd)} · Multa: <strong>{formatKz(feeAmount)}</strong>
                </p>
              </div>
            </label>

            {applyFee ? (
              <div className="mt-3 flex gap-2">
                {FEE_METHODS.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setFeeMethod(m.value)}
                    className={cn(
                      'press-scale flex-1 rounded-xl border px-3 py-2 text-sm font-semibold',
                      feeMethod === m.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface'
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="mt-3 flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
              <AlertCircle size={15} />
              {error}
            </div>
          ) : null}

          <Button className="mt-4 w-full" size="lg" disabled={!selectedSeat} loading={submitting} onClick={confirm}>
            {applyFee ? `Confirmar e cobrar ${formatKz(feeAmount)}` : 'Confirmar reprogramação'}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
