'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, Bus, Ticket, MapPinned, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

const ITEMS = [
  { href: '/', label: 'Início', icon: LayoutGrid },
  { href: '/trips', label: 'Viagens', icon: Bus },
  { href: '/tickets', label: 'Bilhetes', icon: Ticket },
  { href: '/routes', label: 'Rotas', icon: MapPinned },
  { href: '/emergency', label: 'Emergência', icon: TriangleAlert, danger: true },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/90 pb-safe-bottom backdrop-blur-lg">
      <div className="mx-auto flex max-w-md items-stretch justify-between px-1.5 pt-1.5">
        {ITEMS.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="press-scale flex flex-1 flex-col items-center gap-1 rounded-xl px-1 py-1.5"
            >
              <span
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-xl transition-colors',
                  active
                    ? item.danger
                      ? 'bg-danger/15 text-danger'
                      : 'bg-primary/14 text-primary'
                    : 'text-muted-foreground'
                )}
              >
                <Icon size={20} strokeWidth={active ? 2.4 : 2} />
              </span>
              <span
                className={cn(
                  'text-[10.5px] font-medium leading-none',
                  active ? (item.danger ? 'text-danger' : 'text-primary') : 'text-muted-foreground'
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
