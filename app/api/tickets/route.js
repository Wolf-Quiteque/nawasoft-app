import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { TICKET_SELECT, attachPassengers } from '@/lib/tickets';

function toInt(v, fb) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fb;
}

export async function GET(request) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = createSupabaseAdminClient();
  const { searchParams } = new URL(request.url);
  const page = toInt(searchParams.get('page'), 1);
  const limit = Math.min(toInt(searchParams.get('limit'), 20), 50);
  const offset = (page - 1) * limit;
  const search = (searchParams.get('search') || '').trim();
  const status = searchParams.get('status') || '';

  try {
    let matchingIds = null;
    if (search) {
      const { data: matches, error: searchError } = await supabase.rpc('search_admin_ticket_ids', { p_search: search });
      if (searchError) throw searchError;
      matchingIds = (matches || []).map((m) => m.ticket_id);
      if (!matchingIds.length) {
        return NextResponse.json({ tickets: [], pagination: { page, limit, total: 0, totalPages: 0 } });
      }
    }

    let query = supabase
      .from('tickets')
      .select(TICKET_SELECT, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (matchingIds) query = query.in('id', matchingIds);

    const { data: tickets, count, error } = await query;
    if (error) throw error;

    const rows = await attachPassengers(supabase, tickets || []);

    return NextResponse.json({
      tickets: rows,
      pagination: { page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit) },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Falha ao procurar bilhetes' }, { status: 500 });
  }
}
