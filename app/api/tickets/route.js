import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { loadTickets, TICKETS_PAGE_SIZE } from '@/lib/queries/tickets';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { issueInstantTickets, IssueError } from '@/lib/instant-ticket';

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

// POST — issues one or more paid tickets on the spot and returns the single
// link the group downloads them from. See lib/instant-ticket.js.
export async function POST(request) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  const supabase = createSupabaseAdminClient({ actorUserId: auth.user.id, actorRole: auth.profile.role });

  try {
    const result = await issueInstantTickets(supabase, body, auth.user.id);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof IssueError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: err.message || 'Falha ao emitir bilhetes' }, { status: 500 });
  }
}
