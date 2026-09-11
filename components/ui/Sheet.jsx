'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '@/lib/cn';

export default function Sheet({ open, onClose, title, children, maxHeight = '85vh' }) {
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <motion.div
            className="absolute inset-0 bg-black/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            style={{ maxHeight }}
            className="relative z-10 flex w-full max-w-md flex-col rounded-t-3xl border-t border-border bg-surface pb-safe-bottom"
          >
            <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-border" />
            {title ? (
              <div className="flex items-center justify-between px-5 pt-3">
                <h2 className="text-base font-semibold">{title}</h2>
                <button
                  onClick={onClose}
                  className="press-scale flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
                  aria-label="Fechar"
                >
                  <X size={16} />
                </button>
              </div>
            ) : null}
            <div className={cn('overflow-y-auto px-5', title ? 'pt-3' : 'pt-5')}>{children}</div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
