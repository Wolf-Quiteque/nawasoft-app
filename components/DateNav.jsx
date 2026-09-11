'use client';

import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { todayInLuanda } from '@/lib/format';

function shiftDate(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function DateNav({ date, onChange }) {
  const isToday = date === todayInLuanda();
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString('pt-PT', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });

  return (
    <div className="mb-4 flex items-center gap-2">
      <button
        onClick={() => onChange(shiftDate(date, -1))}
        className="press-scale flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface"
        aria-label="Dia anterior"
      >
        <ChevronLeft size={18} />
      </button>

      <div className="relative flex-1">
        <label className="flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-surface text-sm font-semibold">
          <CalendarDays size={15} className="text-primary" />
          <span className="capitalize">{isToday ? 'Hoje' : label}</span>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>

      <button
        onClick={() => onChange(shiftDate(date, 1))}
        className="press-scale flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface"
        aria-label="Dia seguinte"
      >
        <ChevronRight size={18} />
      </button>

      {!isToday ? (
        <button
          onClick={() => onChange(todayInLuanda())}
          className="press-scale rounded-xl bg-primary/12 px-3 text-xs font-bold text-primary"
          style={{ height: '2.5rem' }}
        >
          Hoje
        </button>
      ) : null}
    </div>
  );
}
