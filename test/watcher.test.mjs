import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedger } from '../src/ledger.mjs';
import { watch, REFUND_FEE_ZAT } from '../src/watcher.mjs';
import { buildMemo } from '../web/gift.js';

const UA = 'utest14j43elrxtzx6umn9yzu3pp3tphzgl98gc703xzcs6t8sefhgwhaez9jv2szut7j00v0rfl03cjw0uv9dmcq2zqp3cufu7c2n254dffjfa8qcuyl7usvnktap49cyq343zryet5q5g3dz9rfwyz9a6nuxvwnrnjkzl673sjf2pglk9g5a5nszk4pj3z6z0uez37pfekrpda65sljvdfc';
const ID = 'A'.repeat(43);
const memo = (o = {}) => buildMemo({ id: ID, tier: 10, refundTo: UA, blob: 'abcd', ...o });
const row = (o = {}) => ({ txid: 't1', output: 0, zat: 1000000, memo: memo(), height: 100, ...o });

function setup(rows, { tip = 100, sendFails = false } = {}) {
  const sent = [];
  const ctx = {
    ledger: createLedger(':memory:'),
    wallet: {
      refresh: async () => {},
      incoming: async () => rows,
      tip: async () => tip,
      send: async (s) => { if (sendFails) throw new Error('zcash-devtool could not send'); sent.push(s); return 'r'.repeat(64); },
    },
    limits: { perGift: 101, perDay: 300, floor: 50 },
    now: () => 1000,
    expireMs: 500,
    confirmations: 1,
    log: () => {},
  };
  return { ctx, sent };
}

test('mined_gift_is_confirmed', async () => {
  const { ctx } = setup([row()]);
  await watch(ctx);
  assert.equal(ctx.ledger.get(ID).state, 'confirmed');
});

test('other_memos_are_ignored', async () => {
  const { ctx } = setup([row({ memo: 'practice' })]);
  await watch(ctx);
  assert.equal(ctx.ledger.all().length, 0);
});

test('unmined_gift_waits_then_confirms', async () => {
  const rows = [row({ height: null })];
  const { ctx } = setup(rows);
  await watch(ctx);
  assert.equal(ctx.ledger.get(ID).state, 'seen');
  rows[0] = row();
  await watch(ctx);
  assert.equal(ctx.ledger.get(ID).state, 'confirmed');
});

test('needs_enough_confirmations', async () => {
  const { ctx } = setup([row()], { tip: 100 });
  ctx.confirmations = 3;
  await watch(ctx);
  assert.equal(ctx.ledger.get(ID).state, 'mined');
});

test('second_pass_changes_nothing', async () => {
  const { ctx, sent } = setup([row()]);
  await watch(ctx);
  await watch(ctx);
  assert.equal(ctx.ledger.all().length, 1);
  assert.equal(sent.length, 0);
});

test('underpaid_refunds', async () => {
  const { ctx, sent } = setup([row({ zat: 500000 })]);
  await watch(ctx);
  assert.equal(ctx.ledger.get(ID).state, 'refunded');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].zat, 500000 - REFUND_FEE_ZAT);
  assert.equal(sent[0].address, UA);
});

test('dust_is_refused_without_a_refund', async () => {
  const { ctx, sent } = setup([row({ zat: 5 })]);
  await watch(ctx);
  assert.equal(ctx.ledger.get(ID).state, 'refused');
  assert.equal(sent.length, 0);
});

test('day_over_cap_refunds_new_gifts', async () => {
  const { ctx, sent } = setup([row({ txid: 't2', memo: memo({ id: 'B'.repeat(43) }) })]);
  ctx.ledger.addGift({ id: 'old', txid: 't1', output: 0, zat: 1, tier: 101, refundTo: null, blob: 'b', height: 1, now: 1000 });
  ctx.ledger.setState('old', 'confirmed');
  ctx.ledger.claimOnce('old', { productId: 'p', phone: null, rupees: 295, now: 1000 });
  await watch(ctx);
  assert.equal(ctx.ledger.get('B'.repeat(43)).state, 'refunded');
  assert.equal(sent.length, 1);
});

test('expired_refunds_once', async () => {
  const { ctx, sent } = setup([row()]);
  await watch(ctx);
  ctx.now = () => 2000;
  await watch(ctx);
  await watch(ctx);
  assert.equal(ctx.ledger.get(ID).state, 'refunded');
  assert.equal(sent.length, 1);
  assert.match(sent[0].memo, /Shagun/);
});

test('no_refund_address_stays_expired', async () => {
  const { ctx, sent } = setup([row({ memo: memo({ refundTo: null }) })]);
  await watch(ctx);
  ctx.now = () => 2000;
  await watch(ctx);
  assert.equal(ctx.ledger.get(ID).state, 'expired');
  assert.equal(sent.length, 0);
});

test('failed_refund_needs_a_human_and_is_not_retried', async () => {
  const { ctx } = setup([row({ zat: 500000 })], { sendFails: true });
  await watch(ctx);
  assert.equal(ctx.ledger.get(ID).state, 'needs_human');
  ctx.wallet.send = async () => { throw new Error('should not retry'); };
  await watch(ctx);
  assert.equal(ctx.ledger.get(ID).state, 'needs_human');
});

test('claimed_gift_never_expires', async () => {
  const { ctx, sent } = setup([row()]);
  await watch(ctx);
  ctx.ledger.claimOnce(ID, { productId: 'p', phone: null, rupees: 10, now: 1000 });
  ctx.now = () => 2000;
  await watch(ctx);
  assert.equal(ctx.ledger.get(ID).state, 'claimed');
  assert.equal(sent.length, 0);
});
