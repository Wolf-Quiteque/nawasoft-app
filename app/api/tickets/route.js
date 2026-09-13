import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { loadTickets, TICKETS_PAGE_SIZE } from '@/lib/queries/tickets';

function toInt(v, fb) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fb;
}

export async function GET(request) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);

  try {
    const payload = await loadTickets({
      page: toInt(searchParams.get('page'), 1),
      limit: toInt(searchParams.get('limit'), TICKETS_PAGE_SIZE),
      search: searchParams.get('search') || '',
      status: searchParams.get('status') || '',
    });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Falha ao procurar bilhetes' }, { status: 500 });
  }
}
