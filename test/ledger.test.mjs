import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedger } from '../src/ledger.mjs';

const gift = (over = {}) => ({ id: 'g1', txid: 't1', output: 0, zat: 1000000, tier: 10, refundTo: null, blob: 'b', height: 5, now: 1000, ...over });
const open = () => {
  const l = createLedger(':memory:');
  l.addGift(gift());
  l.setState('g1', 'confirmed');
  return l;
};
const claim = { productId: 'p', phone: 'enc', rupees: 10, now: 2000 };

test('same_payment_twice_one_gift', () => {
  const l = createLedger(':memory:');
  assert.equal(l.addGift(gift()), true);
  assert.equal(l.addGift(gift()), false);
  assert.equal(l.addGift(gift({ txid: 't2' })), false);
  assert.equal(l.all().length, 1);
});

test('claim_twice_is_false', () => {
  const l = open();
  assert.equal(l.claimOnce('g1', claim), true);
  assert.equal(l.claimOnce('g1', claim), false);
});

test('unconfirmed_gift_cannot_be_claimed', () => {
  const l = createLedger(':memory:');
  l.addGift(gift());
  assert.equal(l.claimOnce('g1', claim), false);
});

test('restart_keeps_claims', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'shg-')), 'l.sqlite');
  const a = createLedger(path);
  a.addGift(gift());
  a.setState('g1', 'confirmed');
  a.claimOnce('g1', claim);
  a.close();
  const b = createLedger(path);
  assert.equal(b.get('g1').state, 'claimed');
  assert.equal(b.claimOnce('g1', claim), false);
});

test('spent_today_counts_claims_in_the_india_day', () => {
  const l = createLedger(':memory:');
  const noonIst = Date.UTC(2026, 10, 4, 6, 30);
  const beforeMidnightIst = Date.UTC(2026, 10, 3, 18, 0);
  for (const [id, now] of [['a', noonIst], ['b', noonIst], ['c', beforeMidnightIst]]) {
    l.addGift(gift({ id, txid: id }));
    l.setState(id, 'confirmed');
    l.claimOnce(id, { ...claim, now });
  }
  assert.equal(l.spentToday(noonIst), 20);
});

test('forget_wipes_phone_and_code', () => {
  const l = open();
  l.claimOnce('g1', { ...claim, phone: '+91999' });
  l.setState('g1', 'delivered', { code: 'SECRET' });
  l.forget('g1');
  const g = l.get('g1');
  assert.equal(g.phone, null);
  assert.equal(g.code, null);
  assert.equal(g.state, 'delivered');
});

test('set_state_rejects_unknown_fields', () => {
  assert.throws(() => open().setState('g1', 'x', { nope: 1 }));
});

test('dry_run_purchases_do_not_count_as_spending', () => {
  const l = open();
  l.claimOnce('g1', { ...claim, rupees: 54.32 });
  l.setState('g1', 'delivered', { invoice_id: 'dry-1' });
  assert.equal(l.spentToday(2000), 0);
  l.addGift(gift({ id: 'g2', txid: 't2' }));
  l.setState('g2', 'confirmed');
  l.claimOnce('g2', { ...claim, rupees: 10.65 });
  l.setState('g2', 'buying', { invoice_id: 'real-1' });
  assert.equal(l.spentToday(2000), 10.65);
});

test('a_claim_with_no_invoice_yet_still_counts', () => {
  const l = open();
  l.claimOnce('g1', { ...claim, rupees: 10.65 });
  assert.equal(l.spentToday(2000), 10.65);
});
