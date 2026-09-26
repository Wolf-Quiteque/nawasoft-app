/**
 * Who may settle a sale at the counter.
 *
 * Money taken in cash or on the TPA is money the system only knows about
 * because the person selling said so. Everyone else sells por referência: the
 * seat is reserved and the passenger pays Multicaixa, so the payment is
 * confirmed by the bank, not by the seller.
 */
const COUNTER_SETTLEMENT_EMAILS = ['marcio@nawabus.com'];

export function canSettleAtCounter(email) {
  return COUNTER_SETTLEMENT_EMAILS.includes(String(email || '').trim().toLowerCase());
}

/** The only method the rest of the counter may use. */
export const REFERENCE_ONLY_METHOD = 'referencia';
