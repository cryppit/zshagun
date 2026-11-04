import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGift, checkClaim } from '../src/guard.mjs';

const limits = { perGift: 101, perDay: 300, floor: 50 };
const catalog = [{ id: 'airtel-10', rupees: 10 }, { id: 'amazon-100', rupees: 100 }];

const giftInput = (o = {}) => ({ tier: 10, zat: 1000000, spentToday: 0, limits, ...o });
const claimInput = (o = {}) => ({ tier: 50, productId: 'airtel-10', catalog, spentToday: 0, balance: 1000, limits, ...o });

test('good_gift_passes', () => assert.deepEqual(checkGift(giftInput()), { ok: true }));
test('gift_over_cap', () => assert.equal(checkGift(giftInput({ tier: 102, zat: 1e9 })).reason, 'over_gift_cap'));
test('underpaid_is_refused', () => assert.equal(checkGift(giftInput({ zat: 999999 })).reason, 'underpaid'));
test('day_over_cap_refuses_new_gifts', () => assert.equal(checkGift(giftInput({ spentToday: 295 })).reason, 'over_day_cap'));

test('good_claim_passes', () => assert.deepEqual(checkClaim(claimInput()), { ok: true, product: catalog[0] }));
test('product_not_listed', () => assert.equal(checkClaim(claimInput({ productId: 'x' })).reason, 'product_not_listed'));
test('product_costs_more_than_gift', () => assert.equal(checkClaim(claimInput({ productId: 'amazon-100' })).reason, 'costs_more_than_gift'));
test('claim_over_day_cap', () => assert.equal(checkClaim(claimInput({ spentToday: 295 })).reason, 'over_day_cap'));
test('below_float_floor', () => assert.equal(checkClaim(claimInput({ balance: 59 })).reason, 'below_float_floor'));
test('exactly_at_the_floor_passes', () => assert.equal(checkClaim(claimInput({ balance: 60 })).ok, true));
