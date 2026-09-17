'use client';

import { Armchair, UserRound, Check } from 'lucide-react';
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
  const copilot = seats.find((s) => s.state === 'copilot');
  const rest = seats.filter((s) => s.state !== 'copilot');
  const rows = chunkRows(rest);

  const seatButton = (seat) => {
    const order = orderOf(seat.number);
    const isSelected = multi ? order >= 0 : selectedSeat === seat.number;
    const isOccupied = seat.state === 'occupied';
    const isAvailable = seat.state === 'available';

    return (
      <button
        key={seat.number}
        type="button"
        disabled={isOccupied ? false : !selectable}
        onClick={() => {
          if (isOccupied) onOccupiedTap?.(seat);
          else if (isAvailable && selectable) onSelectSeat?.(seat.number);
        }}
        className={cn(
          'relative flex h-11 w-11 flex-col items-center justify-center rounded-xl border text-[11px] font-bold transition-all press-scale',
          isAvailable && 'border-border bg-surface text-foreground',
          isAvailable && selectable && 'hover:border-primary/50',
          isOccupied && 'border-transparent bg-muted text-muted-foreground',
          isSelected && 'border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/30'
        )}
      >
        {isSelected ? (
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
      {copilot ? (
        <div className="flex w-full items-center justify-end gap-2 pr-1">
          {/* Seat 1 is permanently reserved for the co-pilot (see lib/seats.js). */}
          <span className="text-[11px] font-medium text-muted-foreground">Copiloto</span>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-dashed border-border bg-muted/60 text-muted-foreground">
            <UserRound size={16} />
          </div>
        </div>
      ) : null}

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
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-primary" /> Selecionado</span>
      </div>
    </div>
  );
}
