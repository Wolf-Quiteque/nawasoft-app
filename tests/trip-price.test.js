// Pricing a trip at something other than the route's base price. The rule that
// matters: a blank field means "use the default", never zero — charging nothing
// has to be typed on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPrice, priceInvalid, tripPrices, MAX_PRICE_KZ } from '../lib/trip-price.js';

test('blank means default, not free', () => {
  for (const blank of ['', null, undefined]) assert.equal(readPrice(blank), null);
  assert.equal(readPrice(0), 0);
  assert.equal(readPrice('0'), 0);
});

test('a price must be a real, non-negative, sane number', () => {
  assert.equal(readPrice('9000'), 9000);
  assert.equal(readPrice(10500.5), 10500.5);
  assert.ok(priceInvalid('abc'));
  assert.ok(priceInvalid(-1));
  assert.ok(priceInvalid(MAX_PRICE_KZ + 1));
  assert.ok(priceInvalid(Number.POSITIVE_INFINITY));
  assert.ok(!priceInvalid(''));
  assert.ok(!priceInvalid(MAX_PRICE_KZ));
});

test('no override: the route base price, and no separate online price', () => {
  assert.deepEqual(
    tripPrices({ priceKz: '', onlinePriceKz: '', basePrice: 9000 }),
    { price_usd: 9000, online_price_kz: null }
  );
});

test('the case this was built for: 10.000 at the counter, 9.000 online', () => {
  assert.deepEqual(
    tripPrices({ priceKz: '10000', onlinePriceKz: '9000', basePrice: 9000 }),
    { price_usd: 10000, online_price_kz: 9000 }
  );
});

test('a counter price alone leaves online following it', () => {
  // null online means "same as the counter" to every client, so the website
  // charges 10.000 too rather than falling back to the old base price.
  assert.deepEqual(
    tripPrices({ priceKz: '10000', onlinePriceKz: '', basePrice: 9000 }),
    { price_usd: 10000, online_price_kz: null }
  );
});

test('an online price alone keeps the counter on the route base', () => {
  assert.deepEqual(
    tripPrices({ priceKz: '', onlinePriceKz: '7500', basePrice: 9000 }),
    { price_usd: 9000, online_price_kz: 7500 }
  );
});

test('a campaign trip is free on both channels whatever was typed', () => {
  assert.deepEqual(
    tripPrices({ priceKz: '10000', onlinePriceKz: '9000', basePrice: 9000, isCampaign: true }),
    { price_usd: 0, online_price_kz: null }
  );
});

test('zero is honoured when it is typed', () => {
  assert.deepEqual(
    tripPrices({ priceKz: '0', onlinePriceKz: '0', basePrice: 9000 }),
    { price_usd: 0, online_price_kz: 0 }
  );
});
