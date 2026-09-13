import TicketsView from './TicketsView';
import { requireStaff } from '@/lib/auth';
import { loadTickets } from '@/lib/queries/tickets';

export default async function TicketsPage() {
  const auth = await requireStaff();

  let initialData = null;
  if (!auth.error) {
    try {
      // Matches the view's default state (no search, no status filter), which
      // is what `useApi` will consider already-loaded.
      initialData = await loadTickets({});
    } catch {
      // Leave it unseeded — the client fetch runs and surfaces the error.
    }
  }

  return <TicketsView initialData={initialData} />;
}
