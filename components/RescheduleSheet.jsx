'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Clock, AlertCircle, BadgeCheck } from 'lucide-react';
import Sheet from '@/components/ui/Sheet';
import Button from '@/components/ui/Button';
import DateNav from '@/components/DateNav';
import SeatGrid from '@/components/SeatGrid';
import Skeleton from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatTime, formatKz, todayInLuanda } from '@/lib/format';
import { describeQuote } from '@/lib/rebooking';
import { createLatestGuard } from '@/lib/latest-request';

const PAY_METHODS = [
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
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [payMethod, setPayMethod] = useState('cash');
  const [waive, setWaive] = useState(false);
  const [waiverReason, setWaiverReason] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Taps can fire requests that finish out of order; only the newest may
  // update the sheet (see lib/latest-request.js).
  const optionsGuard = useRef(createLatestGuard());
  const seatsGuard = useRef(createLatestGuard());
  const quoteGuard = useRef(createLatestGuard());
  // One key per confirmed attempt, so a double tap or a retry after a timeout
  // replays the same rebook instead of moving the ticket twice.
  const idemKey = useRef(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setDate(todayInLuanda());
    setSelectedTrip(null);
    setSeatData(null);
    setSelectedSeat(null);
    setQuote(null);
    setPayMethod('cash');
    setWaive(false);
    setWaiverReason('');
    setError(null);
    idemKey.current = null;
  }, [open, ticket?.id]);

  useEffect(() => {
    if (!open || step !== 1) return;
    const token = optionsGuard.current.next();
    const isCurrent = () => optionsGuard.current.isCurrent(token);
    setOptions(null);
    setLoadingOptions(true);
    fetch(`/api/tickets/${ticket.id}/reschedule-options?date=${date}`)
      .then((res) => res.json())
      .then((body) => {
        if (isCurrent()) setOptions(body);
      })
      .catch(() => {
        if (isCurrent()) setOptions(null);
      })
      .finally(() => {
        if (isCurrent()) setLoadingOptions(false);
      });
  }, [open, step, date, ticket?.id]);

  const pickTrip = (trip) => {
    const token = seatsGuard.current.next();
    const isCurrent = () => seatsGuard.current.isCurrent(token);
    setSelectedTrip(trip);
    // A seat chosen on another trip must not carry over to this one.
    setSelectedSeat(null);
    setSeatData(null);
    setQuote(null);
    setError(null);
    setStep(2);
    setLoadingSeats(true);
    fetch(`/api/trips/${trip.trip_id}/seats`)
      .then((res) => res.json())
      .then((body) => {
        if (isCurrent()) setSeatData(body);
      })
      .catch(() => {
        if (isCurrent()) setSeatData(null);
      })
      .finally(() => {
        if (isCurrent()) setLoadingSeats(false);
      });
  };

  // The amounts come from the server every time the seat, the trip or the
  // waiver changes — the sheet never works out a multa of its own.
  useEffect(() => {
    if (!open || step !== 2 || !selectedTrip || !selectedSeat) {
      setQuote(null);
      return;
    }
    const token = quoteGuard.current.next();
    const isCurrent = () => quoteGuard.current.isCurrent(token);
    setQuoting(true);
    setError(null);
    fetch(`/api/tickets/${ticket.id}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        new_trip_id: selectedTrip.trip_id,
        new_seat_number: selectedSeat,
        waive_fee: waive,
        waiver_reason: waive ? 'pré-visualização do perdão da multa' : null,
        dry_run: true,
      }),
    })
      .then(async (res) => {
        const body = await res.json();
        if (!isCurrent()) return;
        if (!res.ok) {
          setQuote(null);
          setError(body.error || 'Não foi possível calcular o valor.');
          return;
        }
        setQuote(describeQuote(body.quote));
      })
      .catch(() => {
        if (isCurrent()) setError('Não foi possível calcular o valor.');
      })
      .finally(() => {
        if (isCurrent()) setQuoting(false);
      });
  }, [open, step, selectedTrip, selectedSeat, waive, ticket?.id]);

  const needsPayment = (quote?.totalKz ?? 0) > 0;
  const waiverTooShort = waive && waiverReason.trim().length < 10;
  const canConfirm = !!selectedSeat && !!quote && !quoting && !waiverTooShort;

  const confirm = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setError(null);
    if (!idemKey.current) idemKey.current = crypto.randomUUID();
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          new_trip_id: selectedTrip.trip_id,
          new_seat_number: selectedSeat,
          payment_method: needsPayment ? payMethod : null,
          waive_fee: waive,
          waiver_reason: waive ? waiverReason.trim() : null,
          idempotency_key: idemKey.current,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Falha ao reprogramar bilhete');
      onSuccess(body);
    } catch (err) {
      // A fresh key on the next attempt only if this one never reached the
      // engine; a refused request keeps its key so a retry cannot double-move.
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
            {!selectedSeat ? (
              <p className="text-sm text-muted-foreground">Escolha um assento para ver o valor a cobrar.</p>
            ) : quoting ? (
              <Skeleton className="h-16" />
            ) : quote ? (
              <>
                {quote.isFree ? (
                  <p className="flex items-center gap-2 text-sm font-semibold text-success">
                    <BadgeCheck size={16} /> Reprogramação gratuita
                  </p>
                ) : null}
                <dl className="flex flex-col gap-1.5 text-sm">
                  {quote.feeKz > 0 ? (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Multa ({quote.feePercent}%)</dt>
                      <dd className="font-semibold">{formatKz(quote.feeKz)}</dd>
                    </div>
                  ) : null}
                  {quote.fareDifferenceKz > 0 ? (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Diferença de tarifa</dt>
                      <dd className="font-semibold">{formatKz(quote.fareDifferenceKz)}</dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between border-t border-border pt-1.5">
                    <dt className="font-semibold">Total a cobrar</dt>
                    <dd className="font-bold">{formatKz(quote.totalKz)}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">
                  Reprogramação {quote.rebooksUsed + 1} de {quote.rebooksAllowed} permitidas.
                </p>

                {needsPayment ? (
                  <div className="mt-3 flex gap-2">
                    {PAY_METHODS.map((m) => (
                      <button
                        key={m.value}
                        onClick={() => setPayMethod(m.value)}
                        className={cn(
                          'press-scale flex-1 rounded-xl border px-3 py-2 text-sm font-semibold',
                          payMethod === m.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface'
                        )}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {quote.feePercent > 0 || waive ? (
                  <div className="mt-3 border-t border-border pt-3">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={waive}
                        onChange={(e) => setWaive(e.target.checked)}
                        className="mt-0.5 h-5 w-5 accent-[var(--color-primary)]"
                      />
                      <div>
                        <p className="text-sm font-semibold">Perdoar a multa</p>
                        <p className="text-xs text-muted-foreground">Fica registado no seu nome, com o motivo.</p>
                      </div>
                    </label>
                    {waive ? (
                      <textarea
                        value={waiverReason}
                        onChange={(e) => setWaiverReason(e.target.value)}
                        rows={2}
                        placeholder="Motivo do perdão (mínimo 10 caracteres)"
                        className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm"
                      />
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          {error ? (
            <div className="mt-3 flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
              <AlertCircle size={15} />
              {error}
            </div>
          ) : null}

          <Button className="mt-4 w-full" size="lg" disabled={!canConfirm} loading={submitting} onClick={confirm}>
            {needsPayment ? `Confirmar e cobrar ${formatKz(quote.totalKz)}` : 'Confirmar reprogramação'}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
