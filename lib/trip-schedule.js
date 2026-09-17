export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function addDays(date, days) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function departureFor(date, time, offsetMinutes = 0) {
  const value = new Date(`${date}T${time}:00+01:00`);
  value.setTime(value.getTime() + offsetMinutes * 60_000);
  return value;
}

export function recurringDates(startDate, endDate, mode, weekdays = [], intervalDays = 1) {
  const dates = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) return dates;
  if (mode === 'interval') {
    if (!Number.isInteger(intervalDays) || intervalDays < 1) return dates;
    for (let date = startDate; date <= endDate; date = addDays(date, intervalDays)) dates.push(date);
    return dates;
  }
  const selected = new Set(weekdays);
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    if (selected.has(new Date(`${date}T12:00:00Z`).getUTCDay())) dates.push(date);
  }
  return dates;
}

export function intervalsOverlap(first, second) {
  return new Date(first.departure_time) < new Date(second.arrival_time)
    && new Date(second.departure_time) < new Date(first.arrival_time);
}

export function shareOneSeatPool(intervals) {
  if (intervals.length <= 1) return true;
  const latestDeparture = Math.max(...intervals.map((item) => new Date(item.departure_time).getTime()));
  const earliestArrival = Math.min(...intervals.map((item) => new Date(item.arrival_time).getTime()));
  return latestDeparture < earliestArrival;
}

export function boundsFor(intervals) {
  return {
    departure_time: intervals.reduce((value, item) => item.departure_time < value ? item.departure_time : value, intervals[0].departure_time),
    arrival_time: intervals.reduce((value, item) => item.arrival_time > value ? item.arrival_time : value, intervals[0].arrival_time),
  };
}

export function assignReplacementSeats(existingSeats, movingSeats, busCapacity) {
  const used = new Set(existingSeats.map(Number));
  // Reserve every valid requested seat first. Otherwise an out-of-range seat
  // processed early could steal seat 4 from a later passenger who already had 4.
  const reserved = new Set();
  for (const value of movingSeats) {
    const seat = Number(value);
    if (seat >= 2 && seat <= Number(busCapacity) && !used.has(seat) && !reserved.has(seat)) reserved.add(seat);
  }
  reserved.forEach((seat) => used.add(seat));
  const assignments = [];
  for (const value of movingSeats) {
    const oldSeat = Number(value);
    let newSeat = reserved.has(oldSeat) ? oldSeat : null;
    if (newSeat == null) {
      for (let seat = 2; seat <= Number(busCapacity); seat += 1) {
        if (!used.has(seat)) { newSeat = seat; break; }
      }
    }
    if (newSeat == null) throw new Error('O autocarro selecionado não tem lugares suficientes.');
    used.add(newSeat);
    assignments.push({ old_seat: oldSeat, new_seat: newSeat });
  }
  return assignments;
}
