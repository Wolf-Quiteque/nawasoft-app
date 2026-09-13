import TripsView from './TripsView';
import { requireStaff } from '@/lib/auth';
import { loadTrips } from '@/lib/queries/trips';
import { todayInLuanda } from '@/lib/format';

export default async function TripsPage() {
  const auth = await requireStaff();
  const date = todayInLuanda();

  let initialData = null;
  if (!auth.error) {
    try {
      initialData = await loadTrips(date);
    } catch {
      // Leave it unseeded — the client fetch runs and surfaces the error.
    }
  }

  return <TripsView initialDate={date} initialData={initialData} />;
}
