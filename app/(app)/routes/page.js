import RoutesView from './RoutesView';
import { requireStaff } from '@/lib/auth';
import { loadRoutes } from '@/lib/queries/routes';

export default async function RoutesPage() {
  const auth = await requireStaff();

  let initialData = null;
  if (!auth.error) {
    try {
      initialData = await loadRoutes();
    } catch {
      // Leave it unseeded — the client fetch runs and surfaces the error.
    }
  }

  return <RoutesView initialData={initialData} />;
}
