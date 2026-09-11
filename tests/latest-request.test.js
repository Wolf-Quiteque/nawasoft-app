// Regression tests for out-of-order responses in the reschedule sheet.
// Bug found 2026-09-11: changing the date quickly let an older, slower
// response replace the newer one, so trips from another day were offered
// and a ticket could be moved onto the wrong date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLatestGuard } from '../lib/latest-request.js';

const delay = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

test('only the newest request is current', () => {
  const guard = createLatestGuard();
  const first = guard.next();
  const second = guard.next();
  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
});

test('a slow response for an older date cannot replace the newer date', async () => {
  const guard = createLatestGuard();
  let shown = null;

  const load = (date, ms) => {
    const token = guard.next();
    return delay(ms, { date }).then((body) => {
      if (guard.isCurrent(token)) shown = body.date;
    });
  };

  // Dispatcher taps from 15 Sep to 21 Sep; the 15 Sep answer arrives last.
  await Promise.all([load('2026-09-15', 60), load('2026-09-21', 10)]);
  assert.equal(shown, '2026-09-21');
});

test('guards are independent of each other', () => {
  const options = createLatestGuard();
  const seats = createLatestGuard();
  const optionsToken = options.next();
  seats.next();
  seats.next();
  assert.equal(options.isCurrent(optionsToken), true);
});
