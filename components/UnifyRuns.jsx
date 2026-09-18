'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * Joins this journey's passengers into another bus running the same day. If
 * that bus doesn't serve one of this journey's routes yet, the route is added
 * to it with the same time and fare, all in one step.
 */
export default function UnifyRuns({ tripId, run, toast, onDone }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [targetId, setTargetId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/trips/${tripId}/unify`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Falha ao procurar autocarros.');
        return body;
      })
      .then((body) => { if (active) setData(body); })
      .catch((error) => toast(error.message, 'error'))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tripId, toast]);

  const candidates = data?.candidates || [];
  const usable = (candidate) => candidate.fits && candidate.times_ok;
  const selected = candidates.find((candidate) => candidate.trip_id === targetId);
  const passengers = data?.run?.sold ?? run?.sold ?? 0;

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/unify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_trip_id: targetId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Não foi possível juntar as viagens.');
      const result = body.result || {};
      const moved = result.moved_passengers ?? passengers;
      const reseated = (result.seat_assignments || []).filter((item) => item.old_seat !== item.new_seat).length;
      const added = (result.added_trip_ids || []).length;
      const parts = [`${moved} passageiro(s) passaram para ${selected?.bus?.license_plate}`];
      if (added) parts.push(`${added} percurso(s) acrescentado(s)`);
      parts.push(reseated ? `${reseated} com novo assento` : 'todos mantiveram o assento');
      toast(`${parts.join(' · ')}.`, 'success');
      onDone();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 pb-5">
      <p className="text-sm text-muted-foreground">
        Os {passengers} passageiro(s) deste autocarro passam para o autocarro escolhido. Se ele ainda não fizer algum destes
        percursos, o percurso é acrescentado com o mesmo horário e preço. Esta viagem sai de venda.
      </p>

      {loading ? <p className="text-sm text-muted-foreground">A procurar autocarros…</p> : null}

      {candidates.map((candidate) => {
        const ok = usable(candidate);
        return (
          <button
            key={candidate.trip_id}
            type="button"
            disabled={!ok}
            onClick={() => setTargetId(candidate.trip_id)}
            className="w-full text-left disabled:opacity-55"
          >
            <Card className={cn('p-3', targetId === candidate.trip_id && 'ring-2 ring-primary')}>
              <div className="flex items-center justify-between">
                <strong>{candidate.bus?.license_plate}</strong>
                <span className="text-xs">{formatTime(candidate.departure_time)}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{candidate.routes.join(' · ')}</p>
              <p className={cn('mt-1 text-xs', candidate.fits ? 'text-muted-foreground' : 'text-danger')}>
                {candidate.sold}/{candidate.capacity} vendidos ·{' '}
                {candidate.fits
                  ? `${candidate.remaining_after_merge} livres depois de juntar`
                  : `faltam ${-candidate.remaining_after_merge} lugares`}
              </p>
              {candidate.missing_routes.length ? (
                <p className={cn(
                  'mt-1.5 rounded-lg px-2 py-1 text-[11px]',
                  candidate.times_ok ? 'bg-warning/15 text-warning-foreground' : 'bg-danger/10 text-danger'
                )}>
                  {candidate.times_ok ? 'Vai acrescentar: ' : 'Horário incompatível com: '}
                  {candidate.missing_routes
                    .map((route) => `${route.origin_city} → ${route.destination_city} às ${formatTime(route.departure_time)}`)
                    .join(', ')}
                </p>
              ) : null}
            </Card>
          </button>
        );
      })}

      {!loading && !candidates.length ? (
        <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">Não há outro autocarro com viagem neste dia.</p>
      ) : null}

      <Button className="w-full" loading={saving} disabled={!selected || !usable(selected)} onClick={save}>
        {selected ? `Juntar ${passengers} passageiro(s) no ${selected.bus?.license_plate}` : 'Escolha o autocarro'}
      </Button>
    </div>
  );
}
