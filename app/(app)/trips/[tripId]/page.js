'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertCircle, Bus as BusIcon, User, SlidersHorizontal, Ticket as TicketIcon, Phone } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Sheet from '@/components/ui/Sheet';
import Skeleton from '@/components/ui/Skeleton';
import SeatGrid from '@/components/SeatGrid';
import CapacityBar from '@/components/CapacityBar';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/ui/Toast';
import { formatTime, formatKz } from '@/lib/format';

export default function TripDetailPage() {
  const { tripId } = useParams();
  const router = useRouter();
  const toast = useToast();

  const { data, loading, error, refetch } = useApi(`/api/trips/${tripId}`);
  const { data: seatData, loading: seatsLoading, refetch: refetchSeats } = useApi(`/api/trips/${tripId}/seats`);

  const [limitOpen, setLimitOpen] = useState(false);
  const [limitValue, setLimitValue] = useState('');
  const [savingLimit, setSavingLimit] = useState(false);
  const [seatSheet, setSeatSheet] = useState(null);

  const openLimitSheet = () => {
    const current = data?.run?.legs?.find((l) => l.sales_capacity_limit != null)?.sales_capacity_limit;
    setLimitValue(current != null ? String(current) : '');
    setLimitOpen(true);
  };

  const saveLimit = async (clear = false) => {
    setSavingLimit(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/sales-limit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: clear ? null : Number(limitValue) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Falha ao atualizar limite');
      toast('Limite de vendas atualizado.', 'success');
      setLimitOpen(false);
      refetch();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSavingLimit(false);
    }
  };

  if (loading && !data) {
    return (
      <div>
        <BackButton fallbackHref="/trips" />
        <Skeleton className="h-32" />
        <Skeleton className="mt-3 h-80" />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <BackButton fallbackHref="/trips" />
        <div className="flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          <AlertCircle size={16} />
          {error}
        </div>
      </div>
    );
  }

  const { run } = data;

  return (
    <div>
      <BackButton fallbackHref="/trips" />

      <Card className="sunset-gradient p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-white/85">
              <BusIcon size={14} />
              <span className="text-sm font-semibold">{run.bus?.license_plate}</span>
            </div>
            <p className="mt-1 text-xl font-black">{formatTime(run.departure_time)}</p>
            <p className="text-xs text-white/80">{run.bus?.make} {run.bus?.model}</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-black leading-none">{run.sold}<span className="text-lg font-semibold text-white/75">/{run.capacity}</span></p>
            <p className="text-[11px] text-white/80">{run.remaining} livres</p>
          </div>
        </div>
        {run.driver ? (
          <div className="mt-3 flex items-center gap-1.5 border-t border-white/20 pt-3 text-xs text-white/90">
            <User size={13} />
            {run.driver.first_name} {run.driver.last_name}
            {run.driver.phone_number ? (
              <span className="flex items-center gap-1 opacity-80"><Phone size={11} />{run.driver.phone_number}</span>
            ) : null}
          </div>
        ) : null}
      </Card>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm font-bold text-muted-foreground">Percursos</p>
        <button onClick={openLimitSheet} className="press-scale flex items-center gap-1.5 text-xs font-semibold text-primary">
          <SlidersHorizontal size={13} />
          Limite de vendas
        </button>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {run.legs.map((leg) => (
          <Card key={leg.trip_id} className="flex items-center justify-between p-3">
            <div>
              <p className="text-sm font-semibold">{leg.origin_city} → {leg.destination_city}</p>
              {leg.sales_capacity_limit != null ? (
                <p className="text-[11px] text-muted-foreground">Limite: {leg.sales_capacity_limit}</p>
              ) : null}
            </div>
            <Badge tone="primary">{leg.sold}</Badge>
          </Card>
        ))}
      </div>

      <p className="mb-2 mt-5 text-sm font-bold text-muted-foreground">Mapa de assentos</p>
      <Card className="p-4">
        {seatsLoading && !seatData ? (
          <Skeleton className="h-64" />
        ) : seatData ? (
          <SeatGrid
            seats={seatData.seats}
            selectable={false}
            onOccupiedTap={(seat) => setSeatSheet(seat)}
          />
        ) : null}
      </Card>

      <Sheet open={limitOpen} onClose={() => setLimitOpen(false)} title="Limite de vendas">
        <p className="mb-3 text-sm text-muted-foreground">
          Reduz temporariamente os lugares à venda para esta viagem (aplica-se a todos os percursos deste autocarro).
        </p>
        <Input
          type="number"
          min={0}
          placeholder={`Sem limite (até ${run.capacity})`}
          value={limitValue}
          onChange={(e) => setLimitValue(e.target.value)}
        />
        <div className="mt-4 flex gap-2 pb-4">
          <Button variant="secondary" className="flex-1" onClick={() => saveLimit(true)} loading={savingLimit}>
            Remover limite
          </Button>
          <Button className="flex-1" onClick={() => saveLimit(false)} loading={savingLimit} disabled={limitValue === ''}>
            Guardar
          </Button>
        </div>
      </Sheet>

      <Sheet open={Boolean(seatSheet)} onClose={() => setSeatSheet(null)} title={seatSheet ? `Assento ${seatSheet.number}` : ''}>
        {seatSheet?.ticket ? (
          <div className="flex flex-col gap-3 pb-6">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <TicketIcon size={18} />
              </span>
              <div>
                <p className="font-bold">{seatSheet.ticket.passenger_name || 'Passageiro'}</p>
                <p className="text-xs text-muted-foreground">{seatSheet.ticket.ticket_number}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-muted p-2.5">
                <p className="text-[11px] text-muted-foreground">Percurso</p>
                <p className="font-semibold">{seatSheet.ticket.leg}</p>
              </div>
              <div className="rounded-xl bg-muted p-2.5">
                <p className="text-[11px] text-muted-foreground">Valor</p>
                <p className="font-semibold">{formatKz(seatSheet.ticket.price_paid_usd)}</p>
              </div>
            </div>
            <Button className="w-full" onClick={() => router.push(`/tickets/${seatSheet.ticket.id}`)}>
              Ver bilhete
            </Button>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
