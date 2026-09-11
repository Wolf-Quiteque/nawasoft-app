import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import TopBar from '@/components/TopBar';
import BottomNav from '@/components/BottomNav';
import { ToastProvider } from '@/components/ui/Toast';

export default async function AppLayout({ children }) {
  const { error, profile } = await requireStaff();
  if (error) redirect('/login');

  return (
    <ToastProvider>
      <div className="min-h-dvh bg-background">
        <TopBar profile={profile} />
        <main className="mx-auto max-w-md px-4 pb-28 pt-3">{children}</main>
        <BottomNav />
      </div>
    </ToastProvider>
  );
}
