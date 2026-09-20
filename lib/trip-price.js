// Trip pricing, shared by the scheduler and the "alterar preços" action.
//
// Two prices per trip, both in Kz despite the legacy `price_usd` column name:
//   price_usd       the counter price — what Sunmi terminals and agents charge
//   online_price_kz the website price; null means "same as the counter price",
//                   which is how every client already reads it
//
// A blank field means "use the default", never zero. Charging nothing has to be
// typed as 0 on purpose.

export const MAX_PRICE_KZ = 10_000_000;

/** `null` for blank, a number when valid, `undefined` when the value is unusable. */
export function readPrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE_KZ) return undefined;
  return n;
}

export function priceInvalid(value) {
  return readPrice(value) === undefined;
}

/**
 * What a trip will actually be created with.
 * `basePrice` is the route's base price times the seat-class multiplier.
 */
export function tripPrices({ priceKz, onlinePriceKz, basePrice, isCampaign = false }) {
  if (isCampaign) return { price_usd: 0, online_price_kz: null };
  const counter = readPrice(priceKz);
  const online = readPrice(onlinePriceKz);
  return {
    price_usd: counter ?? Number(basePrice),
    online_price_kz: online,
  };
}
