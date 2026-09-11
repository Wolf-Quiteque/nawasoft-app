/**
 * Keeps only the newest of several overlapping requests.
 *
 * Fast taps (changing the reschedule date, picking another trip) fire
 * requests that can finish out of order. Without a guard, a slower, older
 * response overwrites the newer one, so the sheet can show one day's trips
 * under another day's label and move a passenger onto the wrong day.
 *
 * Call next() when starting a request and keep the token; apply the result
 * only if isCurrent(token) is still true when it arrives.
 */
export function createLatestGuard() {
  let latest = 0;
  return {
    next() {
      latest += 1;
      return latest;
    },
    isCurrent(token) {
      return token === latest;
    },
  };
}
