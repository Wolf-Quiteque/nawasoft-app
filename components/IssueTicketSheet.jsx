'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, Ticket as TicketIcon, User, Phone, TicketPercent, Users } from 'lucide-react';
import Sheet from '@/components/ui/Sheet';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import SeatGrid from '@/components/SeatGrid';
import { cn } from '@/lib/cn';
import { formatKz } from '@/lib/format';
import { parsePassengerList } from '@/lib/passenger-list';
import { useToast } from '@/components/ui/Toast';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Dinheiro' },
  { value: 'tpa', label: 'TPA' },
  { value: 'referencia', label: 'Referência' },
];

/** The Multicaixa entity every Nawabus reference is paid under. */
const MULTICAIXA_ENTITY = '1219';

function formatReference(reference) {
  // Read out loud at the counter, so grouped in threes: 123 456 789
  return String(reference || '').replace(/(\d{3})(?=\d)/g, '$1 ');
}

function formatExpiry(iso) {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  return when.toLocaleString('pt-PT', {
    timeZone: 'Africa/Luanda',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });
}

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
        {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

/**
 * Issues tickets for walk-up passengers without leaving the trip screen.
 *
 * Groups are the common case (a family booked on one contact number), so the
 * list mode takes a pasted WhatsApp list as-is and everyone comes back on one
 * download link. Closing on that link is the point — handing it over is the
 * last step of the sale, not an afterthought.
 */
export default function IssueTicketSheet({ open, onClose, run, seats, onIssued }) {
  const toast = useToast();

  const [mode, setMode] = useState('single');
  const [legId, setLegId] = useState(null);
  const [name, setName] = useState('');
  const [bi, setBi] = useState('');
  const [listText, setListText] = useState('');
  const [pickedSeats, setPickedSeats] = useState([]);
  const [phone, setPhone] = useState('');
  const [promo, setPromo] = useState('');
  const [method, setMethod] = useState('cash');
  const [saving, setSaving] = useState(false);
  const [issued, setIssued] = useState(null);
  const [copied, setCopied] = useState(false);

  const legs = run?.legs || [];
  const selectedLeg = legs.find((l) => l.trip_id === (legId ?? legs[0]?.trip_id)) || null;

  const parsed = useMemo(() => (mode === 'list' ? parsePassengerList(listText) : []), [mode, listText]);
  const passengers = mode === 'list'
    ? parsed
    : name.trim()
      ? [{ name: name.trim(), national_id: bi.trim() || null }]
      : [];

  const freeSeats = useMemo(() => (seats || []).filter((s) => s.state === 'available'), [seats]);
  const needed = passengers.length;
  const seatsReady = needed > 0 && pickedSeats.length === needed;

  const toggleSeat = (n) => {
    setPickedSeats((prev) => {
      if (prev.includes(n)) return prev.filter((s) => s !== n);
      if (needed && prev.length >= needed) {
        // Replace the oldest pick so tapping past the limit still feels live
        // rather than silently doing nothing.
        return [...prev.slice(1), n];
      }
      return [...prev, n];
    });
  };

  /** Fills the remaining picks with the lowest free seats, keeping the group together. */
  const autoAssign = () => {
    const free = freeSeats.map((s) => s.number).filter((n) => !pickedSeats.includes(n));
    setPickedSeats((prev) => [...prev, ...free.slice(0, Math.max(needed - prev.length, 0))]);
  };

  const reset = () => {
    setMode('single');
    setName('');
    setBi('');
    setListText('');
    setPickedSeats([]);
    setPhone('');
    setPromo('');
    setMethod('cash');
    setIssued(null);
    setCopied(false);
  };

  const close = () => {
    onClose?.();
    // Let the sheet finish sliding out before the contents snap back.
    setTimeout(reset, 300);
  };

  const submit = async (overrideSalesLimit = false) => {
    if (!selectedLeg) return toast('Selecione o percurso.', 'error');
    if (!needed) return toast('Indique pelo menos um passageiro.', 'error');
    if (!seatsReady) {
      return toast(`Selecione ${needed} ${needed === 1 ? 'assento' : 'assentos'}.`, 'error');
    }

    setSaving(true);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trip_id: selectedLeg.trip_id,
          passengers: passengers.map((p, i) => ({
            name: p.name,
            national_id: p.national_id || null,
            seat_number: pickedSeats[i],
          })),
          contact_phone: phone.trim() || null,
          promotion_code: promo.trim() || null,
          payment_method: method,
          override_sales_limit: overrideSalesLimit,
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        // The run is capped below the bus's size. Raising the cap is the
        // caller's call, so ask instead of quietly selling past it.
        if (body.code === 'sales_limit_reached') {
          if (window.confirm(body.error)) return submit(true);
          return;
        }
        throw new Error(body.error || 'Falha ao emitir bilhetes');
      }

      setIssued(body);
      toast(body.count > 1 ? `${body.count} bilhetes emitidos.` : 'Bilhete emitido.', 'success');
      onIssued?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const awaitingPayment = issued?.payment_status === 'pending';

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Não foi possível copiar. Copie manualmente.', 'error');
    }
  };
  const copyLink = () => copyText(issued.download_url);

  const title = issued
    ? awaitingPayment
      ? issued.count > 1 ? `${issued.count} lugares reservados` : 'Lugar reservado'
      : issued.count > 1 ? `${issued.count} bilhetes emitidos` : 'Bilhete emitido'
    : 'Emitir bilhetes';

  return (
    <Sheet open={open} onClose={close} title={title}>
      {issued ? (
        <div className="flex flex-col gap-3 pb-6">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-muted p-2.5">
              <p className="text-[11px] text-muted-foreground">Total</p>
              <p className="font-semibold">{formatKz(issued.total_due_kz)}</p>
            </div>
            <div className="rounded-xl bg-muted p-2.5">
              <p className="text-[11px] text-muted-foreground">Desconto</p>
              <p className="font-semibold">
                {issued.total_discount_kz > 0 ? `−${formatKz(issued.total_discount_kz)}` : '—'}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border">
            {issued.tickets.map((t, i) => (
              <div
                key={t.ticket_id}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5',
                  i > 0 && 'border-t border-border'
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-xs font-bold text-primary">
                  {t.seat_number}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{t.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{t.ticket_number}</p>
                </div>
              </div>
            ))}
          </div>

          {awaitingPayment ? (
            <div className="rounded-2xl border border-primary/40 bg-primary/8 p-3">
              <p className="text-[11px] font-semibold text-muted-foreground">
                Referência Multicaixa — Entidade {MULTICAIXA_ENTITY}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <p className="min-w-0 flex-1 text-2xl font-bold tracking-wide text-foreground">
                  {formatReference(issued.reference)}
                </p>
                <button
                  onClick={() => copyText(issued.reference)}
                  className="press-scale flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"
                  aria-label="Copiar referência"
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatKz(issued.total_due_kz)}
                {formatExpiry(issued.reference_expires_at)
                  ? ` · pagar até ${formatExpiry(issued.reference_expires_at)}`
                  : ''}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {issued.count > 1 ? 'Os lugares ficam' : 'O lugar fica'} reservado{issued.count > 1 ? 's' : ''} em nome
                {issued.count > 1 ? ' dos passageiros' : ' do passageiro'}. O bilhete só pode ser descarregado depois do pagamento.
              </p>
            </div>
          ) : null}

          <div>
            <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
              Link de descarga {issued.count > 1 ? `(${issued.count} bilhetes num PDF)` : ''}
              {awaitingPayment ? ' — activo após o pagamento' : ''}
            </p>
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/50 p-2.5">
              <p className="min-w-0 flex-1 break-all text-xs text-foreground">{issued.download_url}</p>
              <button
                onClick={copyLink}
                className="press-scale flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"
                aria-label="Copiar link"
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
          </div>

          <Button className="w-full" onClick={close}>Concluir</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5 pb-6">
          <div className="flex gap-2">
            {[
              { value: 'single', label: 'Um passageiro', icon: <User size={14} /> },
              { value: 'list', label: 'Vários', icon: <Users size={14} /> },
            ].map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => { setMode(m.value); setPickedSeats([]); }}
                className={cn(
                  'press-scale flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors',
                  mode === m.value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-surface text-foreground'
                )}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>

          {legs.length > 1 ? (
            <Field label="Percurso">
              <div className="flex flex-wrap gap-2">
                {legs.map((leg) => {
                  const active = selectedLeg?.trip_id === leg.trip_id;
                  return (
                    <button
                      key={leg.trip_id}
                      type="button"
                      onClick={() => setLegId(leg.trip_id)}
                      className={cn(
                        'press-scale rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-surface text-foreground'
                      )}
                    >
                      {leg.origin_city} → {leg.destination_city}
                    </button>
                  );
                })}
              </div>
            </Field>
          ) : null}

          {mode === 'single' ? (
            <>
              <Field label="Nome do passageiro">
                <Input
                  icon={<User size={16} />}
                  placeholder="Nome completo"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="BI (opcional)">
                <Input placeholder="000000000LA000" value={bi} onChange={(e) => setBi(e.target.value)} />
              </Field>
            </>
          ) : (
            <Field
              label="Lista de passageiros"
              hint={needed ? `${needed} ${needed === 1 ? 'nome' : 'nomes'}` : 'um por linha'}
            >
              <textarea
                rows={6}
                value={listText}
                onChange={(e) => setListText(e.target.value)}
                placeholder={'1- Eduardo Nguenda Cussecala - BI: 006050336LA048\n2- Julio Tavares Domingos\n3- Maria Fineza Nenganga'}
                className="w-full rounded-2xl border border-border bg-surface p-3 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground outline-none transition-shadow focus:ring-2 focus:ring-ring/40"
              />
            </Field>
          )}

          <Field label="Telefone de contacto (opcional)" hint={mode === 'list' ? 'para todos' : undefined}>
            <Input
              icon={<Phone size={16} />}
              inputMode="numeric"
              placeholder="9XX XXX XXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>

          <Field label="Código promocional (opcional)">
            <Input
              icon={<TicketPercent size={16} />}
              placeholder="Ex.: CONECTA2026"
              value={promo}
              onChange={(e) => setPromo(e.target.value.toUpperCase())}
              autoCapitalize="characters"
            />
          </Field>

          <Field label="Pagamento">
            <div className="flex gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(m.value)}
                  className={cn(
                    'press-scale flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors',
                    method === m.value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-surface text-foreground'
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </Field>

          <Field
            label={needed ? `Assentos (${pickedSeats.length}/${needed})` : 'Assentos'}
            hint={
              needed && pickedSeats.length < needed ? (
                <button type="button" onClick={autoAssign} className="font-semibold text-primary">
                  Atribuir automaticamente
                </button>
              ) : undefined
            }
          >
            {freeSeats.length ? (
              <div className="rounded-2xl border border-border p-3">
                <SeatGrid seats={seats} selectedSeats={pickedSeats} onSelectSeat={toggleSeat} />
              </div>
            ) : (
              <p className="rounded-2xl bg-muted p-3 text-xs text-muted-foreground">
                Não há assentos livres neste autocarro.
              </p>
            )}
          </Field>

          {mode === 'list' && passengers.length ? (
            <div className="overflow-hidden rounded-2xl border border-border">
              {passengers.map((p, i) => (
                <div key={i} className={cn('flex items-center gap-3 px-3 py-2', i > 0 && 'border-t border-border')}>
                  <span
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold',
                      pickedSeats[i] != null
                        ? 'bg-primary/12 text-primary'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {pickedSeats[i] ?? '—'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{p.name}</p>
                    {p.national_id ? (
                      <p className="truncate text-[11px] text-muted-foreground">{p.national_id}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {(run?.remaining ?? 0) < needed && freeSeats.length ? (
            <p className="rounded-xl bg-warning/20 px-3 py-2 text-[11px] text-warning-foreground">
              A viagem atingiu o limite de vendas. Vai ser pedida confirmação para aumentar o limite.
            </p>
          ) : null}

          <Button className="w-full" onClick={() => submit(false)} loading={saving} disabled={!seatsReady}>
            <TicketIcon size={16} />
            {needed > 1 ? `Emitir ${needed} bilhetes` : 'Emitir bilhete'}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
