'use client';

import { Armchair, Check } from 'lucide-react';
import { cn } from '@/lib/cn';

function chunkRows(seats) {
  const rows = [];
  for (let i = 0; i < seats.length; i += 4) rows.push(seats.slice(i, i + 4));
  return rows;
}

export default function SeatGrid({
  seats,
  selectedSeat,
  selectedSeats,
  onSelectSeat,
  onOccupiedTap,
  selectable = true,
}) {
  // Callers pick one seat (rescheduling) or several (issuing for a group);
  // `order` is what turns the second case into "this seat is passenger 3".
  const multi = Array.isArray(selectedSeats);
  const orderOf = (n) => (multi ? selectedSeats.indexOf(n) : -1);
  const rows = chunkRows(seats);

  const seatButton = (seat) => {
    const isCopilot = seat.state === 'copilot';
    const order = orderOf(seat.number);
    const isSelected = !isCopilot && (multi ? order >= 0 : selectedSeat === seat.number);
    const isOccupied = seat.state === 'occupied';
    const isAvailable = seat.state === 'available';

    return (
      <button
        key={seat.number}
        type="button"
        disabled={isCopilot || (isOccupied ? false : !selectable)}
        onClick={() => {
          if (isOccupied) onOccupiedTap?.(seat);
          else if (isAvailable && selectable) onSelectSeat?.(seat.number);
        }}
        className={cn(
          'relative flex h-11 w-11 flex-col items-center justify-center rounded-xl border text-[11px] font-bold transition-all press-scale',
          isCopilot && 'cursor-not-allowed border-amber-500 bg-amber-100 text-amber-900 dark:border-amber-400 dark:bg-amber-950 dark:text-amber-200',
          isAvailable && 'border-border bg-surface text-foreground',
          isAvailable && selectable && 'hover:border-primary/50',
          isOccupied && 'border-transparent bg-muted text-muted-foreground',
          isSelected && 'border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/30'
        )}
      >
        {isCopilot ? (
          <span className="leading-none">CP</span>
        ) : isSelected ? (
          multi ? <span className="text-[13px] leading-none">{order + 1}</span> : <Check size={16} />
        ) : (
          <Armchair size={16} className={isOccupied ? 'opacity-60' : 'opacity-70'} />
        )}
        <span className="mt-0.5 leading-none">{seat.number}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-col gap-2">
        {rows.map((row, ri) => (
          <div key={ri} className="flex items-center gap-2">
            {seatButton(row[0])}
            {row[1] ? seatButton(row[1]) : <div className="h-11 w-11" />}
            <div className="w-3" />
            {row[2] ? seatButton(row[2]) : <div className="h-11 w-11" />}
            {row[3] ? seatButton(row[3]) : <div className="h-11 w-11" />}
          </div>
        ))}
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-border bg-surface" /> Livre</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-muted" /> Ocupado</span>
        <span className="flex items-center gap-1.5"><span className="flex h-3 w-3 items-center justify-center rounded border border-amber-500 bg-amber-100 text-[7px] font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-200">CP</span> Copiloto</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-primary" /> Selecionado</span>
      </div>
    </div>
  );
}
