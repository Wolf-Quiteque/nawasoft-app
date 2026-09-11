'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, MapPinned, AlertCircle, ArrowRight } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { SkeletonList } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useApi } from '@/lib/useApi';
import { cn } from '@/lib/cn';

export default function RoutesPage() {
  const { data, loading, error } = useApi('/api/routes');
  const [open, setOpen] = useState(() => new Set());

  const toggle = (province) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(province)) next.delete(province);
      else next.add(province);
      return next;
    });
  };

  return (
    <div>
      <PageHeader title="Rotas" subtitle="Rotas agrupadas por província" />

      {error ? (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          <AlertCircle size={16} />
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <SkeletonList count={4} itemClassName="h-16" />
      ) : data?.provinces?.length ? (
        <div className="flex flex-col gap-3">
          {data.provinces.map((group, gi) => {
            // The first province starts open; tapping any header flips it.
            // (It used to be forced open, so it could never be collapsed.)
            const isOpen = gi === 0 ? !open.has(group.province) : open.has(group.province);
            return (
              <Card key={group.province} className="overflow-hidden">
                <button
                  onClick={() => toggle(group.province)}
                  className="press-scale flex w-full items-center justify-between p-4"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
                      <MapPinned size={17} />
                    </span>
                    <div className="text-left">
                      <p className="font-bold">{group.province}</p>
                      <p className="text-xs text-muted-foreground">{group.routes.length} rota{group.routes.length === 1 ? '' : 's'}</p>
                    </div>
                  </div>
                  <ChevronDown size={18} className={cn('text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                </button>

                <AnimatePresence initial={false}>
                  {isOpen ? (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22 }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-col gap-1.5 border-t border-border px-3 pb-3 pt-2">
                        {group.routes.map((route) => (
                          <Link
                            key={route.id}
                            href={`/routes/${route.id}`}
                            className="press-scale flex items-center gap-2.5 rounded-xl px-2.5 py-2.5"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 text-sm font-semibold">
                                <span className="truncate">{route.origin_city}</span>
                                <ArrowRight size={12} className="shrink-0 text-muted-foreground" />
                                <span className="truncate">{route.destination_city}</span>
                              </div>
                              <p className="text-xs text-muted-foreground">{route.destination_province}</p>
                            </div>
                            {route.today_trip_count > 0 ? (
                              <Badge tone="primary">{route.today_sold} hoje</Badge>
                            ) : (
                              <Badge tone="neutral">Sem viagem</Badge>
                            )}
                          </Link>
                        ))}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={MapPinned} title="Nenhuma rota encontrada" />
      )}
    </div>
  );
}
