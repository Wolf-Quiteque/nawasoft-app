import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignReplacementSeats,
  recurringDates,
  shareOneSeatPool,
} from '../lib/trip-schedule.js';

test('seat replacement preserves sellable seats and avoids co-pilot seat 3', () => {
  assert.deepEqual(assignReplacementSeats([2, 3], [14, 50, 4], 35), [
    { old_seat: 14, new_seat: 14 },
    { old_seat: 50, new_seat: 1 },
    { old_seat: 4, new_seat: 4 },
  ]);
});

test('seat replacement moves a passenger off the newly reserved seat', () => {
  assert.deepEqual(assignReplacementSeats([], [3], 10), [
    { old_seat: 3, new_seat: 1 },
  ]);
});

test('seat replacement rejects a merge that does not fit', () => {
  assert.throws(() => assignReplacementSeats([1, 2, 4], [4, 5], 4), /lugares suficientes/);
});

test('weekly schedules include only selected weekdays', () => {
  assert.deepEqual(recurringDates('2026-09-14', '2026-09-20', 'weekdays', [1, 3, 5]), [
    '2026-09-14', '2026-09-16', '2026-09-18',
  ]);
});

test('route windows must overlap to share one bus seat pool', () => {
  assert.equal(shareOneSeatPool([
    { departure_time: '2026-09-17T17:00:00Z', arrival_time: '2026-09-18T03:00:00Z' },
    { departure_time: '2026-09-17T19:00:00Z', arrival_time: '2026-09-18T03:00:00Z' },
  ]), true);
  assert.equal(shareOneSeatPool([
    { departure_time: '2026-09-17T08:00:00Z', arrival_time: '2026-09-17T10:00:00Z' },
    { departure_time: '2026-09-17T11:00:00Z', arrival_time: '2026-09-17T13:00:00Z' },
  ]), false);
});
