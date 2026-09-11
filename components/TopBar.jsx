'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import Sheet from '@/components/ui/Sheet';
import Button from '@/components/ui/Button';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { initials } from '@/lib/format';

export default function TopBar({ profile }) {
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const router = useRouter();

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      await getSupabaseBrowserClient().auth.signOut();
    } finally {
      router.replace('/login');
      router.refresh();
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 pt-safe-top backdrop-blur-lg">
      <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="sunset-gradient flex h-8 w-8 items-center justify-center rounded-xl text-sm font-black text-white shadow-sm">
            N
          </span>
          <span className="text-[15px] font-bold tracking-tight">NAWASOFT</span>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="press-scale flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground"
        >
          {initials(profile?.first_name, profile?.last_name)}
        </button>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)}>
        <div className="flex flex-col items-center gap-3 pb-6 pt-2 text-center">
          <span className="sunset-gradient flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-black text-white">
            {initials(profile?.first_name, profile?.last_name)}
          </span>
          <div>
            <p className="text-lg font-bold">
              {profile?.first_name} {profile?.last_name}
            </p>
            <p className="text-sm capitalize text-muted-foreground">{profile?.role}</p>
          </div>
          <Button variant="secondary" className="mt-2 w-full" onClick={handleLogout} loading={loggingOut}>
            <LogOut size={16} />
            Terminar sessão
          </Button>
        </div>
      </Sheet>
    </header>
  );
}
