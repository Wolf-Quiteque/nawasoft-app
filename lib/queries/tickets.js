import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { TICKET_SELECT, attachPassengers } from '@/lib/tickets';

export const TICKETS_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** A page of tickets, optionally filtered by free-text search and status. */
export async function loadTickets({ page = 1, limit = TICKETS_PAGE_SIZE, search = '', status = '' } = {}) {
  const supabase = createSupabaseAdminClient();
  const size = Math.min(limit, MAX_PAGE_SIZE);
  const offset = (page - 1) * size;
  const term = search.trim();

  let matchingIds = null;
  if (term) {
    const { data: matches, error: searchError } = await supabase.rpc('search_admin_ticket_ids', { p_search: term });
    if (searchError) throw new Error(searchError.message);
    matchingIds = (matches || []).map((m) => m.ticket_id);
    if (!matchingIds.length) {
      return { tickets: [], pagination: { page, limit: size, total: 0, totalPages: 0 } };
    }
  }

  let query = supabase
    .from('tickets')
    .select(TICKET_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + size - 1);

  if (status) query = query.eq('status', status);
  if (matchingIds) query = query.in('id', matchingIds);

  const { data: tickets, count, error } = await query;
  if (error) throw new Error(error.message);

  const rows = await attachPassengers(supabase, tickets || []);
  const total = count || 0;

  return {
    tickets: rows,
    pagination: { page, limit: size, total, totalPages: Math.ceil(total / size) },
  };
}
