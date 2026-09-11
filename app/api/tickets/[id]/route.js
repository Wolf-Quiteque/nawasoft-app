import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { TICKET_SELECT, attachPassengers } from '@/lib/tickets';

export async function GET(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const supabase = createSupabaseAdminClient();

  const { data: ticket, error } = await supabase.from('tickets').select(TICKET_SELECT).eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!ticket) return NextResponse.json({ error: 'Bilhete não encontrado.' }, { status: 404 });

  const [withPassenger] = await attachPassengers(supabase, [ticket]);
  return NextResponse.json({ ticket: withPassenger });
}

// PATCH { action: 'refund' } — releases the seat and marks the ticket refunded.
export async function PATCH(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  if (body.action !== 'refund') {
    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('tickets')
    .update({ status: 'refunded', payment_status: 'refunded' })
    .eq('id', id)
    .in('status', ['active', 'used'])
    .eq('payment_status', 'paid')
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: 'Bilhete não pode ser reembolsado (não pago, já reembolsado/cancelado, ou inativo).' },
      { status: 409 }
    );
  }

  return NextResponse.json({
    message: 'Bilhete reembolsado com sucesso. O assento foi libertado.',
    ticket: data[0],
  });
}
