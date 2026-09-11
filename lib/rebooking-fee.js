// Kept in sync with admin-app/lib/rebooking-fee.js and the
// ticket_rebooking_fees_percentage_check constraint (allows 50 or 60; new
// rows default to 60 as of 2026-09-11).
export const REBOOKING_FEE_PERCENT = 60;

export function rebookingFeeAmount(baseAmount, percent = REBOOKING_FEE_PERCENT) {
  const base = Number(baseAmount) || 0;
  return Math.round(base * percent) / 100;
}
