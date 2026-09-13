import DashboardView from './DashboardView';
import { requireStaff } from '@/lib/auth';
import { loadDashboard } from '@/lib/queries/dashboard';

// Rendered on the server so the fleet board arrives with the HTML. The old
// client-only version had to download and boot JS, then make a second
// authenticated round trip to /api/dashboard before it could show anything but
// a skeleton — on a phone that was the difference between "instant" and
// "several seconds of shimmer".
export default async function DashboardPage() {
  // Pages render in parallel with their layout, so the layout's guard is not
  // enough to keep a service-role query from running for a signed-out request.
  // requireStaff() is cache()d, so this shares the layout's check rather than
  // repeating it.
  const auth = await requireStaff();

  let initialData = null;
  if (!auth.error) {
    try {
      initialData = await loadDashboard();
    } catch {
      // Leave it unseeded — the client fetch runs and surfaces the error.
    }
  }

  return <DashboardView initialData={initialData} />;
}
