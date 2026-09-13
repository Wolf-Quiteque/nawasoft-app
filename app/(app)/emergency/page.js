'use client';

import { useState } from 'react';
import { TriangleAlert, ShieldCheck, AlertCircle, Bus as BusIcon } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Sheet from '@/components/ui/Sheet';
import Skeleton from '@/components/ui/Skeleton';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/ui/Toast';
import { formatDateTime } from '@/lib/format';

export default function EmergencyPage() {
  const { data, loading, error, refetch } = useApi('/api/emergency');
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const act = async (action) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/emergency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Falha ao atualizar estado');
      toast(
        action === 'stop' ? `${body.stopped} autocarro(s) parado(s).` : `${body.resumed} autocarro(s) reativado(s).`,
        'success'
      );
      setConfirmOpen(false);
      refetch();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !data) {
    return (
      <div>
        <PageHeader title="Emergência" subtitle="Parar ou retomar vendas em todo o sistema" />
        <Skeleton className="h-44" />
      </div>
    );
  }

  const isActive = data?.active;

  return (
    <div>
      <PageHeader title="Emergência" subtitle="Parar ou retomar vendas em todo o sistema" />

      {error ? (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          <AlertCircle size={16} />
          {error}
        </div>
      ) : null}

      <div className="animate-rise-in">
        <Card
          className={
            isActive
              ? 'border-danger/30 bg-danger/8 p-5'
              : 'p-5'
          }
        >
          <div className="flex items-center gap-3">
            <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${isActive ? 'bg-danger/15 text-danger' : 'bg-success/15 text-success'}`}>
              {isActive ? <TriangleAlert size={22} /> : <ShieldCheck size={22} />}
            </span>
            <div>
              <p className="font-extrabold">{isActive ? 'Vendas paradas' : 'Vendas ativas'}</p>
              <p className="text-sm text-muted-foreground">
                {isActive
                  ? `${data.stop.bus_ids.length} autocarro(s) fora de venda`
                  : `${data.activeCount} de ${data.totalCount} autocarros a vender`}
              </p>
            </div>
          </div>

          {isActive && data.stop ? (
            <div className="mt-3 rounded-xl bg-surface p-3 text-xs text-muted-foreground">
              Parado por {data.stop.activated_by?.first_name} {data.stop.activated_by?.last_name} em{' '}
              {formatDateTime(data.stop.activated_at)}
              {data.stop.reason ? <p className="mt-1 text-foreground">"{data.stop.reason}"</p> : null}
            </div>
          ) : null}

          <Button
            className="mt-4 w-full"
            size="lg"
            variant={isActive ? 'success' : 'danger'}
            onClick={() => (isActive ? act('resume') : setConfirmOpen(true))}
            loading={submitting && isActive}
          >
            {isActive ? 'Retomar vendas' : 'Parar todas as vendas'}
          </Button>
        </Card>
      </div>

      <p className="mb-2 mt-5 text-sm font-bold text-muted-foreground">Autocarros</p>
      <div className="flex flex-col gap-2">
        {(data?.buses || []).map((bus) => (
          <Card key={bus.id} className="flex items-center justify-between p-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <BusIcon size={14} />
              </span>
              <span className="text-sm font-semibold">{bus.license_plate}</span>
            </div>
            <span className={`h-2.5 w-2.5 rounded-full ${bus.is_active ? 'bg-success' : 'bg-muted-foreground/40'}`} />
          </Card>
        ))}
      </div>

      <Sheet open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Parar todas as vendas?">
        <p className="pb-2 text-sm text-muted-foreground">
          Isto desativa imediatamente todos os autocarros ativos em todos os canais de venda (app, website, Sunmi).
          Nenhum bilhete novo poderá ser vendido até retomar.
        </p>
        <div className="mt-3 flex gap-2 pb-6">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmOpen(false)}>
            Cancelar
          </Button>
          <Button variant="danger" className="flex-1" loading={submitting} onClick={() => act('stop')}>
            Parar vendas
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
