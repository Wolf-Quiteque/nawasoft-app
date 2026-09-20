import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { rebookErrorMessage, rebookErrorStatus } from '@/lib/rebooking';

// POST { new_trip_id, new_seat_number, payment_method, waive_fee, waiver_reason,
//        idempotency_key, dry_run }
//
// Every rule — free window, multa, fare difference, the cap of three, seat and
// route checks — lives in `rebook_ticket` (admin-app migration
// 20260920_rebooking_engine.sql). This route only carries the request there and
// translates the answer; it never computes an amount, so nothing an admin sends
// from the browser can change what is charged.
//
// `dry_run: true` returns the quote to show before confirming.
export async function POST(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.profile.role !== 'admin') {
    return NextResponse.json({ error: 'Só administradores podem reprogramar no NAWASOFT.' }, { status: 403 });
  }

  const { id: ticket_id } = await params;
  const payload = await request.json().catch(() => ({}));
  const {
    new_trip_id,
    new_seat_number,
    payment_method = null,
    waive_fee = false,
    waiver_reason = null,
    idempotency_key = null,
    dry_run = false,
  } = payload;

  if (!new_trip_id || new_seat_number == null) {
    return NextResponse.json({ error: 'new_trip_id e new_seat_number são obrigatórios' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient({ actorUserId: auth.user.id, actorRole: auth.profile.role });

  const { data, error } = await supabase.rpc('rebook_ticket', {
    p_ticket_id: ticket_id,
    p_new_trip_id: new_trip_id,
    p_new_seat_number: Number(new_seat_number),
    p_channel: 'nawasoft',
    p_actor_user_id: auth.user.id,
    p_idempotency_key: dry_run ? null : idempotency_key,
    p_payment_method: payment_method,
    p_waive_fee: waive_fee === true,
    p_waiver_reason: waiver_reason,
    p_dry_run: dry_run === true,
  });

  if (error) {
    const { code, message } = rebookErrorMessage(error);
    return NextResponse.json({ error: message, code }, { status: rebookErrorStatus(code) });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return NextResponse.json({ error: 'Sem resposta do servidor.' }, { status: 500 });
  if (dry_run) return NextResponse.json({ quote: row });

  const paid = Number(row.total_kz) || 0;
  return NextResponse.json({
    message: paid > 0
      ? `Bilhete reprogramado. Cobrados ${paid.toLocaleString('pt-AO')} Kz · recibo ${row.receipt_number}.`
      : 'Bilhete reprogramado sem custo. O assento anterior foi libertado.',
    rebook: row,
  });
}
