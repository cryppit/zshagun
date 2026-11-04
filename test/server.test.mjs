import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedger } from '../src/ledger.mjs';
import { createApp } from '../src/server.mjs';
import { claimToken, giftId, newAgentKey, newSecret, sealPhone } from '../web/gift.js';

const catalog = [
  { id: 'airtel', name: 'Airtel', label: '₹10 recharge', kind: 'recharge', rupees: 10.65, packageValue: '10', needsPhone: true },
  { id: 'card', name: 'Card', label: '₹10 gift card', kind: 'card', rupees: 10.65, packageValue: '10', needsPhone: false },
  { id: 'big', name: 'Big', label: '₹100 gift card', kind: 'card', rupees: 104.38, packageValue: '100', needsPhone: false },
];
const limits = { perGift: 101, perDay: 300, floor: 50 };
const key = await newAgentKey();
const PHONE = '+919876543210';

function fakeBitrefill(over = {}) {
  const bought = [];
  return {
    bought,
    quote: async (p) => ({ rupees: p.rupees, balance: 1000, inStock: true }),
    buy: async (o) => { bought.push(o); return `inv${bought.length}`; },
    waitDelivered: async () => ({ status: 'delivered', details: [{ label: 'Code', value: 'CODE-1' }], link: null, instructions: 'Use it', expires: null }),
    ...over,
  };
}

async function start(over = {}) {
  const secret = newSecret();
  const token = await claimToken(secret);
  const id = await giftId(secret);
  const ledger = over.ledger ?? createLedger(':memory:');
  ledger.addGift({ id, txid: `t${id}`, output: 0, zat: 1100000, tier: 11, refundTo: over.refundTo ?? null, blob: 'blob', height: 5, now: 0 });
  ledger.setState(id, 'confirmed');
  const lines = [];
  const sent = [];
  const bitrefill = over.bitrefill ?? fakeBitrefill();
  const app = createApp({
    ledger, bitrefill, catalog: over.catalogFn ? () => catalog.slice(1, 2) : catalog, limits, agentKey: key, now: () => 1000, log: (l) => lines.push(l),
    wallet: { send: async (s) => { sent.push(s); return 'z'.repeat(64); } },
    origins: ['https://cryppit.github.io'], claimsPerMinute: over.claimsPerMinute ?? 100,
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const claim = async (body = {}, headers = {}) => fetch(`${base}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ id, token, productId: 'card', ...body }),
  });
  const status = async (t = token) => fetch(`${base}/claim/${id}`, { headers: { 'x-shagun-token': t } });
  return { app, base, id, token, ledger, bitrefill, lines, sent, claim, status, stop: () => app.server.close() };
}

test('health', async (t) => {
  const s = await start(); t.after(s.stop);
  assert.equal((await fetch(`${s.base}/health`)).status, 200);
});

test('unknown_gift_404', async (t) => {
  const s = await start(); t.after(s.stop);
  assert.equal((await fetch(`${s.base}/gift/nope`)).status, 404);
});

test('gift_shows_tier_message_and_affordable_choices', async (t) => {
  const s = await start(); t.after(s.stop);
  const g = await (await fetch(`${s.base}/gift/${s.id}`)).json();
  assert.equal(g.tier, 11);
  assert.equal(g.choices[0].label, '₹10 recharge');
  assert.equal(g.choices[0].rupees, undefined);
  assert.equal(g.state, 'open');
  assert.equal(g.blob, 'blob');
  assert.deepEqual(g.choices.map((c) => c.id), ['airtel', 'card']);
  assert.ok(g.key.x);
  assert.equal(g.key.d, undefined);
});

test('wrong_secret_403', async (t) => {
  const s = await start(); t.after(s.stop);
  assert.equal((await s.claim({ token: await claimToken(newSecret()) })).status, 403);
  assert.equal(s.bitrefill.bought.length, 0);
});

test('claim_then_result', async (t) => {
  const s = await start(); t.after(s.stop);
  const r = await s.claim();
  assert.equal(r.status, 202);
  await s.app.settled();
  const c = await (await s.status()).json();
  assert.equal(c.state, 'delivered');
  assert.deepEqual(c.details, [{ label: 'Code', value: 'CODE-1' }]);
  assert.equal(c.instructions, 'Use it');
});

test('double_claim_one_purchase', async (t) => {
  const s = await start(); t.after(s.stop);
  const rs = await Promise.all([s.claim(), s.claim(), s.claim()]);
  await s.app.settled();
  assert.deepEqual(rs.map((r) => r.status).sort(), [202, 409, 409]);
  assert.equal(s.bitrefill.bought.length, 1);
});

test('recharge_opens_the_sealed_phone', async (t) => {
  const s = await start(); t.after(s.stop);
  const r = await s.claim({ productId: 'airtel', phone: await sealPhone(key.publicJwk, PHONE) });
  assert.equal(r.status, 202);
  await s.app.settled();
  assert.equal(s.bitrefill.bought[0].phone, PHONE);
  assert.equal(s.ledger.get(s.id).phone, null);
});

test('recharge_without_a_good_phone_changes_nothing', async (t) => {
  const s = await start(); t.after(s.stop);
  assert.equal((await s.claim({ productId: 'airtel' })).status, 400);
  assert.equal((await s.claim({ productId: 'airtel', phone: await sealPhone(key.publicJwk, 'abc') })).status, 400);
  assert.equal(s.ledger.get(s.id).state, 'confirmed');
});

test('guard_refusal_keeps_the_gift_open', async (t) => {
  const s = await start(); t.after(s.stop);
  const r = await s.claim({ productId: 'big' });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'costs_more_than_gift');
  assert.equal(s.ledger.get(s.id).state, 'confirmed');
});

test('a_live_price_above_the_gift_is_refused', async (t) => {
  const s = await start({ bitrefill: fakeBitrefill({ quote: async () => ({ rupees: 11.5, balance: 1000, inStock: true }) }) });
  t.after(s.stop);
  const r = await s.claim();
  assert.equal((await r.json()).error, 'costs_more_than_gift');
  assert.equal(s.ledger.get(s.id).state, 'confirmed');
  assert.equal(s.bitrefill.bought.length, 0);
});

test('spend_is_recorded_at_the_live_price', async (t) => {
  const s = await start({ bitrefill: fakeBitrefill({ quote: async () => ({ rupees: 10.9, balance: 1000, inStock: true }) }) });
  t.after(s.stop);
  await s.claim();
  await s.app.settled();
  assert.equal(s.ledger.get(s.id).rupees, 10.9);
});

test('out_of_stock_keeps_the_gift_open', async (t) => {
  const s = await start({ bitrefill: fakeBitrefill({ quote: async () => ({ rupees: 10.65, balance: 1000, inStock: false }) }) });
  t.after(s.stop);
  const r = await s.claim();
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'out_of_stock');
  assert.equal(s.ledger.get(s.id).state, 'confirmed');
});

test('catalog_can_change_while_running', async (t) => {
  const s = await start({ catalogFn: true }); t.after(s.stop);
  const g = await (await fetch(`${s.base}/gift/${s.id}`)).json();
  assert.deepEqual(g.choices.map((c) => c.id), ['card']);
});

test('bitrefill_down_before_buying_keeps_the_gift_open', async (t) => {
  const s = await start({ bitrefill: fakeBitrefill({ quote: async () => { throw new Error('Bitrefill: down'); } }) });
  t.after(s.stop);
  const r = await s.claim();
  assert.equal(r.status, 503);
  assert.match((await r.json()).message, /Bitrefill/);
  assert.equal(s.ledger.get(s.id).state, 'confirmed');
});

test('failed_buy_is_needs_human_and_never_retried', async (t) => {
  let n = 0;
  const s = await start({ bitrefill: fakeBitrefill({ buy: async () => { n++; throw new Error('Bitrefill: broke'); } }) });
  t.after(s.stop);
  await s.claim();
  await s.app.settled();
  assert.equal((await (await s.status()).json()).state, 'needs_human');
  assert.equal((await s.claim()).status, 409);
  assert.equal(n, 1);
});

test('a_buy_that_returns_nothing_never_crashes_the_agent', async (t) => {
  const s = await start({ bitrefill: fakeBitrefill({ buy: async () => undefined }) });
  t.after(s.stop);
  await s.claim();
  await s.app.settled();
  assert.equal((await (await s.status()).json()).state, 'needs_human');
  assert.equal((await fetch(`${s.base}/health`)).status, 200);
});

test('a_ledger_failure_after_buying_never_crashes_the_agent', async (t) => {
  const s = await start({ bitrefill: fakeBitrefill({ waitDelivered: async () => { throw new Error('boom'); } }) });
  t.after(s.stop);
  await s.claim();
  await s.app.settled();
  assert.equal(s.ledger.get(s.id).state, 'needs_human');
  assert.equal((await fetch(`${s.base}/health`)).status, 200);
});

test('a_card_with_no_code_falls_back_to_its_order_link', async (t) => {
  const s = await start({ bitrefill: fakeBitrefill({ waitDelivered: async () => ({ status: 'delivered', details: [], link: null, accessLink: 'https://b.test/o#k' }) }) });
  t.after(s.stop);
  await s.claim();
  await s.app.settled();
  assert.equal((await (await s.status()).json()).link, 'https://b.test/o#k');
});

test('a_recharge_never_shows_an_order_link', async (t) => {
  const s = await start({ bitrefill: fakeBitrefill({ waitDelivered: async () => ({ status: 'delivered', details: [], link: null, accessLink: 'https://b.test/o#k' }) }) });
  t.after(s.stop);
  await s.claim({ productId: 'airtel', phone: await sealPhone(key.publicJwk, PHONE) });
  await s.app.settled();
  const c = await (await s.status()).json();
  assert.equal(c.link, undefined);
  assert.equal(s.ledger.get(s.id).code, null);
});

test('undelivered_is_needs_human', async (t) => {
  const s = await start({ bitrefill: fakeBitrefill({ waitDelivered: async () => ({ status: 'needs_human' }) }) });
  t.after(s.stop);
  await s.claim();
  await s.app.settled();
  assert.equal((await (await s.status()).json()).state, 'needs_human');
});

test('code_stays_until_seen_then_is_wiped', async (t) => {
  const s = await start(); t.after(s.stop);
  await s.claim();
  await s.app.settled();
  assert.equal((await (await s.status()).json()).details[0].value, 'CODE-1');
  assert.equal((await (await s.status()).json()).details[0].value, 'CODE-1');
  const ack = await fetch(`${s.base}/claim/${s.id}/seen`, { method: 'POST', headers: { 'x-shagun-token': s.token } });
  assert.equal(ack.status, 204);
  assert.equal((await (await s.status()).json()).details, undefined);
  assert.equal(s.ledger.get(s.id).code, null);
});

test('status_needs_the_token', async (t) => {
  const s = await start(); t.after(s.stop);
  await s.claim();
  await s.app.settled();
  assert.equal((await s.status('wrong')).status, 403);
});

test('opened_gift_reads_already_opened', async (t) => {
  const s = await start(); t.after(s.stop);
  await s.claim();
  await s.app.settled();
  assert.equal((await (await fetch(`${s.base}/gift/${s.id}`)).json()).state, 'already_opened');
});

test('giver_gets_an_opened_memo', async (t) => {
  const s = await start({ refundTo: 'utest1giver' }); t.after(s.stop);
  await s.claim();
  await s.app.settled();
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].address, 'utest1giver');
  assert.match(s.sent[0].memo, /opened/);
  assert.equal(s.ledger.get(s.id).opened_txid, 'z'.repeat(64));
});

test('opened_memo_sends_whole_zatoshis', async (t) => {
  const s = await start({ refundTo: 'utest1giver' }); t.after(s.stop);
  await s.claim();
  await s.app.settled();
  assert.ok(Number.isInteger(s.sent[0].zat), String(s.sent[0].zat));
  assert.equal(s.sent[0].zat, 25000);
});

test('reload_after_crash_shows_result', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shg-'));
  const path = join(dir, 'l.sqlite');
  const ledger = createLedger(path);
  const s = await start({ ledger });
  s.ledger.claimOnce(s.id, { productId: 'card', phone: null, rupees: 10.65, now: 1 });
  s.ledger.setState(s.id, 'buying', { invoice_id: 'inv9' });
  await s.app.recover();
  await s.app.settled();
  s.stop();
  assert.equal(s.ledger.get(s.id).state, 'delivered');
  assert.equal(s.bitrefill.bought.length, 0);
});

test('crash_before_the_invoice_is_needs_human_not_a_retry', async (t) => {
  const s = await start(); t.after(s.stop);
  s.ledger.claimOnce(s.id, { productId: 'card', phone: null, rupees: 10.65, now: 1 });
  await s.app.recover();
  await s.app.settled();
  assert.equal(s.ledger.get(s.id).state, 'needs_human');
  assert.equal(s.bitrefill.bought.length, 0);
});

test('rate_limit', async (t) => {
  const s = await start({ claimsPerMinute: 2 }); t.after(s.stop);
  const h = { 'cf-connecting-ip': '1.2.3.4' };
  await s.claim({ token: 'x' }, h);
  await s.claim({ token: 'x' }, h);
  assert.equal((await s.claim({ token: 'x' }, h)).status, 429);
  assert.notEqual((await s.claim({ token: 'x' }, { 'cf-connecting-ip': '5.6.7.8' })).status, 429);
});

test('cors_pages_origin_only', async (t) => {
  const s = await start(); t.after(s.stop);
  const good = await fetch(`${s.base}/health`, { headers: { origin: 'https://cryppit.github.io' } });
  assert.equal(good.headers.get('access-control-allow-origin'), 'https://cryppit.github.io');
  const bad = await fetch(`${s.base}/health`, { headers: { origin: 'https://evil.test' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(`${s.base}/claim`, { method: 'OPTIONS', headers: { origin: 'https://cryppit.github.io' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /x-shagun-token/);
});

test('bad_json_is_a_400', async (t) => {
  const s = await start(); t.after(s.stop);
  const r = await fetch(`${s.base}/claim`, { method: 'POST', body: '{nope' });
  assert.equal(r.status, 400);
});

test('no_secret_phone_or_ip_in_logs', async (t) => {
  const s = await start(); t.after(s.stop);
  await s.claim({ productId: 'airtel', phone: await sealPhone(key.publicJwk, PHONE) }, { 'cf-connecting-ip': '9.9.9.9' });
  await s.app.settled();
  await s.status();
  const all = s.lines.join('\n');
  assert.ok(s.lines.length > 0);
  for (const bad of [s.token, '9876543210', '9.9.9.9', 'CODE-1']) assert.ok(!all.includes(bad), bad);
});
