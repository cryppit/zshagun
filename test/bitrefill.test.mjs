import test from 'node:test';
import assert from 'node:assert/strict';
import { createBitrefill, createDryBitrefill, createMcpClient, readInvoice, BitrefillError } from '../src/bitrefill.mjs';

const product = { id: 'airtel-india', packageValue: '10', rupees: 10 };

function fakeClient(replies) {
  const calls = [];
  return {
    calls,
    async call(name, args) {
      calls.push({ name, args });
      const r = replies[name];
      const next = Array.isArray(r) ? r.shift() : r;
      if (next instanceof Error) throw next;
      return next;
    },
  };
}
const opts = (client, o = {}) => ({ client, sleep: async () => {}, pollMs: 1, timeoutMs: 50, log: () => {}, ...o });

test('buy_uses_catalog_package_value', async () => {
  const client = fakeClient({ 'buy-products': '{"response":{"invoice_id":"inv1"}}' });
  const b = createBitrefill(opts(client));
  assert.equal(await b.buy({ product, phone: '+919999999999' }), 'inv1');
  assert.deepEqual(client.calls[0].args, {
    cart_items: [{ product_id: 'airtel-india', package_value: '10', refill_input: '919999999999' }],
    payment_method: 'balance',
  });
});

const details = (btc, usd) => `id: airtel-india
account_balances:
  product_currency: INR
  balances[4]:
    - payment_method: balance
      balance_currency: BTC
      amount: "0.00000000"
      equivalent_in_product_currency:
        amount: "${btc}"
        amount_base: 0
    - payment_method: balance
      balance_currency: USD
      amount: "1.00"
      equivalent_in_product_currency:
        amount: "${usd}"
    - payment_method: cashback
      balance_currency: BTC
      amount: "1.00000000"
      equivalent_in_product_currency:
        amount: "99999.00"`;

test('balance_is_rupees_from_the_fullest_sub_account', async () => {
  const client = fakeClient({ 'get-product-details': details('0.00', '2,500.50') });
  assert.equal(await createBitrefill(opts(client)).balance(), 2500.5);
  assert.deepEqual(client.calls[0].args, { product_id: 'airtel-india', currency: 'INR' });
});

test('buy_pays_from_the_sub_account_that_has_money', async () => {
  const client = fakeClient({ 'get-product-details': details('0.00', '2500.00'), 'buy-products': '{"response":{"invoice_id":"inv1"}}' });
  const b = createBitrefill(opts(client));
  await b.balance();
  await b.buy({ product, phone: null });
  assert.equal(client.calls[1].args.balance_currency, 'USD');
});

test('no_balance_section_reads_as_zero', async () => {
  const client = fakeClient({ 'get-product-details': 'id: airtel-india' });
  assert.equal(await createBitrefill(opts(client)).balance(), 0);
});

test('quote_reads_the_live_price_and_balance_in_one_call', async () => {
  const text = `in_stock: true\npackages[1]{package_value,package_currency,payment_price,payment_currency}:\n  "10",INR,"11.20",INR\nurl: x\n${details('0.00', '500.00')}`;
  const client = fakeClient({ 'get-product-details': text });
  const q = await createBitrefill(opts(client)).quote({ slug: 'airtel-india', packageValue: '10' });
  assert.deepEqual(q, { rupees: 11.2, balance: 500, inStock: true });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].args.product_id, 'airtel-india');
});

test('quote_for_a_vanished_package_is_out_of_stock', async () => {
  const client = fakeClient({ 'get-product-details': 'in_stock: true\npackages[0]{package_value,package_currency,payment_price,payment_currency}:\nurl: x' });
  assert.equal((await createBitrefill(opts(client)).quote({ slug: 'a', packageValue: '10' })).inStock, false);
});

test('reads_the_invoice_id_from_the_real_reply_shape', async () => {
  const reply = JSON.stringify({ response: { invoice_id: 'inv-real', invoice_access_token: 't' }, agent_instructions: 'poll it' });
  const client = fakeClient({ 'buy-products': reply });
  assert.equal(await createBitrefill(opts(client)).buy({ product, phone: null }), 'inv-real');
});

test('a_reply_with_no_invoice_id_throws_and_names_bitrefill', async () => {
  const client = fakeClient({ 'buy-products': '{"response":{}}' });
  await assert.rejects(createBitrefill(opts(client)).buy({ product, phone: null }), /Bitrefill.*no invoice/);
  assert.equal(client.calls.length, 1);
});

test('a_reply_that_is_not_json_throws_and_names_bitrefill', async () => {
  const client = fakeClient({ 'buy-products': 'invoice_id: abc' });
  await assert.rejects(createBitrefill(opts(client)).buy({ product, phone: null }), /Bitrefill/);
});

test('reads_invoice_status_not_just_status', () => {
  const text = 'id: inv1\ninvoice_status: complete\norders[1]:\n  - id: o1\n    status: delivered\n    redemption_info:\n      code: ABC';
  const r = readInvoice(text);
  assert.equal(r.state, 'complete');
  assert.equal(r.code, 'ABC');
});

test('an_order_status_is_never_mistaken_for_the_invoice_status', () => {
  const text = 'invoice_status: payment_confirmed\norders[1]:\n  - id: o1\n    status: processing';
  assert.equal(readInvoice(text).state, 'payment_confirmed');
});

test('invoice_status_in_json_too', () => {
  assert.equal(readInvoice('{"invoice_status":"complete","orders":[]}').state, 'complete');
  assert.equal(readInvoice('{"response":{"invoice_status":"complete","orders":[]}}').state, 'complete');
});

test('all_orders_delivered_counts_even_if_the_invoice_lags', () => {
  assert.equal(readInvoice('{"invoice_status":"payment_confirmed","orders":[{"status":"delivered"}]}').state, 'complete');
  assert.equal(readInvoice('invoice_status: payment_confirmed\norders[1]:\n  - id: o1\n    status: delivered').state, 'complete');
});

test('gift_card_has_no_phone', async () => {
  const client = fakeClient({ 'buy-products': '{"response":{"invoice_id":"inv1"}}' });
  await createBitrefill(opts(client)).buy({ product, phone: null });
  assert.equal('refill_input' in client.calls[0].args.cart_items[0], false);
});

test('package_field_can_follow_the_live_schema', async () => {
  const client = fakeClient({ 'buy-products': '{"response":{"invoice_id":"inv1"}}' });
  await createBitrefill(opts(client, { packageField: 'package_id' })).buy({ product, phone: null });
  assert.equal(client.calls[0].args.cart_items[0].package_id, '10');
});

test('buy_is_never_retried', async () => {
  const client = fakeClient({ 'buy-products': new BitrefillError('may have started', 'PAYMENT_UNCERTAIN') });
  await assert.rejects(createBitrefill(opts(client)).buy({ product, phone: null }), /Bitrefill/);
  assert.equal(client.calls.length, 1);
});

test('paid_is_not_delivered', async () => {
  const client = fakeClient({ 'get-invoice-by-id': ['invoice_status: payment_confirmed', 'invoice_status: pending', 'invoice_status: complete\norders[1]:\n  - status: delivered'] });
  const r = await createBitrefill(opts(client)).waitDelivered('inv1');
  assert.equal(r.status, 'delivered');
  assert.equal(client.calls.length, 3);
});

test('delivered_returns_code', async () => {
  const text = 'id: inv1\ninvoice_status: complete\norders[1]:\n  - id: o1\n    status: delivered\n    redemption_info:\n      code: ABCD-1234\n      pin: "77"';
  const client = fakeClient({ 'get-invoice-by-id': text });
  assert.deepEqual(await createBitrefill(opts(client)).waitDelivered('inv1'), { status: 'delivered', code: 'ABCD-1234', pin: '77', link: null });
});

test('reads_a_json_invoice_too', () => {
  const r = readInvoice('{"status":"complete","orders":[{"status":"delivered","redemption_info":{"link":"https://x.test/r"}}]}');
  assert.deepEqual(r, { state: 'complete', code: null, pin: null, link: 'https://x.test/r', failed: false });
});

test('recharge_has_no_code', async () => {
  const client = fakeClient({ 'get-invoice-by-id': 'invoice_status: complete' });
  assert.deepEqual(await createBitrefill(opts(client)).waitDelivered('inv1'), { status: 'delivered', code: null, pin: null, link: null });
});

test('timeout_is_needs_human', async () => {
  let t = 0;
  const client = fakeClient({ 'get-invoice-by-id': { toString: () => 'status: pending' } });
  client.call = async () => 'invoice_status: pending';
  const b = createBitrefill(opts(client, { now: () => (t += 30) }));
  assert.equal((await b.waitDelivered('inv1')).status, 'needs_human');
});

test('blocked_or_failed_is_needs_human', async () => {
  for (const text of ['invoice_status: blocked', 'invoice_status: denied', 'invoice_status: payment_error', 'invoice_status: pending\norders[1]:\n  - status: failed']) {
    const client = fakeClient({ 'get-invoice-by-id': text });
    assert.equal((await createBitrefill(opts(client)).waitDelivered('inv1')).status, 'needs_human', text);
  }
});

test('poll_errors_keep_polling', async () => {
  const client = fakeClient({ 'get-invoice-by-id': [new BitrefillError('down', 'SERVICE_UNAVAILABLE'), 'invoice_status: complete'] });
  assert.equal((await createBitrefill(opts(client)).waitDelivered('inv1')).status, 'delivered');
});

test('code_never_logged', async () => {
  const lines = [];
  const client = fakeClient({ 'buy-products': '{"response":{"invoice_id":"inv1"}}', 'get-invoice-by-id': 'invoice_status: complete\n  code: SECRET-CODE' });
  const b = createBitrefill(opts(client, { log: (l) => lines.push(l) }));
  await b.buy({ product, phone: '+919876543210' });
  await b.waitDelivered('inv1');
  assert.ok(!lines.join('\n').includes('SECRET-CODE'));
  assert.ok(!lines.join('\n').includes('9876543210'));
});

test('dry_run_never_touches_the_client', async () => {
  const b = createDryBitrefill({ balance: 500 });
  const id = await b.buy({ product, phone: null });
  assert.match(id, /^dry-/);
  assert.equal((await b.waitDelivered(id)).status, 'delivered');
  assert.equal(await b.balance(), 500);
});

const reply = (body, type = 'application/json', status = 200) => new Response(body, { status, headers: { 'content-type': type } });

test('mcp_sends_both_accept_types_and_the_token', async () => {
  let seen;
  const fetch = async (url, init) => { seen = init; return reply(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'hi' }] } })); };
  const c = createMcpClient({ url: 'https://x.test/mcp', token: 'K', fetch });
  assert.equal(await c.call('search-products', { query: 'a' }), 'hi');
  assert.match(seen.headers.Accept, /application\/json/);
  assert.match(seen.headers.Accept, /text\/event-stream/);
  assert.equal(seen.headers.Authorization, 'Bearer K');
  assert.equal(JSON.parse(seen.body).params.name, 'search-products');
});

test('mcp_reads_an_event_stream', async () => {
  const body = `event: message\ndata: ${JSON.stringify({ result: { content: [{ text: 'hi' }] } })}\n\n`;
  const c = createMcpClient({ url: 'u', token: 'K', fetch: async () => reply(body, 'text/event-stream') });
  assert.equal(await c.call('x', {}), 'hi');
});

test('service_error_names_bitrefill', async () => {
  const text = JSON.stringify({ error: 'balance too low', code: 'INVALID_INPUT', details: { status: 'balance_too_low' } });
  const fetch = async () => reply(JSON.stringify({ result: { isError: true, content: [{ text }] } }));
  const c = createMcpClient({ url: 'u', token: 'K', fetch });
  await assert.rejects(c.call('x', {}), (e) => e instanceof BitrefillError && /Bitrefill/.test(e.message) && e.code === 'INVALID_INPUT' && e.status === 'balance_too_low');
});

test('http_failure_names_bitrefill_without_the_token', async () => {
  const c = createMcpClient({ url: 'u', token: 'TOPSECRET', fetch: async () => reply('Unauthorized', 'text/plain', 401) });
  await assert.rejects(c.call('x', {}), (e) => /Bitrefill.*401/.test(e.message) && !e.message.includes('TOPSECRET'));
});

test('catalog_id_can_differ_from_the_bitrefill_slug', async () => {
  const client = fakeClient({ 'buy-products': '{"response":{"invoice_id":"inv1"}}' });
  await createBitrefill(opts(client)).buy({ product: { id: 'vi-20', slug: 'vi-india', packageValue: '20' }, phone: null });
  assert.equal(client.calls[0].args.cart_items[0].product_id, 'vi-india');
});

const realList = (await import('node:fs')).readFileSync(new URL('./fixtures/list-invoices.txt', import.meta.url), 'utf8');

test('reads_the_real_invoice_output', () => {
  const r = readInvoice(realList);
  assert.equal(r.state, 'complete');
  assert.equal(r.failed, false);
  assert.equal(r.code, null);
});

test('a_failed_order_in_table_form_is_seen', () => {
  const text = 'invoice_status: payment_confirmed\norders[1]{product_id,product,value,currency,status,refunded}:\n  airtel-india,Airtel India 10 INR,"10",INR,failed,false';
  assert.equal(readInvoice(text).failed, true);
});

test('a_refunded_order_in_table_form_is_seen', () => {
  const text = 'invoice_status: complete\norders[1]{product_id,product,value,currency,status,refunded}:\n  airtel-india,Airtel India 10 INR,"10",INR,delivered,true';
  assert.equal(readInvoice(text).failed, true);
});

test('all_delivered_status_counts_as_complete', () => {
  assert.equal(readInvoice('invoice_status: payment_confirmed\norders_delivery_status: all_delivered').state, 'complete');
});

const realInvoice = (await import('node:fs')).readFileSync(new URL('./fixtures/invoice-real.txt', import.meta.url), 'utf8');

test('reads_a_real_single_invoice', () => {
  const r = readInvoice(realInvoice);
  assert.equal(r.state, 'complete');
  assert.equal(r.failed, false);
  assert.equal(r.code, null);
  assert.equal(r.link, null);
  assert.equal(r.accessLink, 'https://www.bitrefill.com/account/x#y');
});

test('a_payment_status_is_not_an_order_status', () => {
  const text = realInvoice.replace('orders_delivery_status: all_delivered', 'orders_delivery_status: not_delivered').replace('    status: delivered', '    status: processing').replace('invoice_status: complete', 'invoice_status: payment_confirmed');
  assert.equal(readInvoice(text).state, 'payment_confirmed');
});

test('waiting_hands_back_the_access_link', async () => {
  const client = fakeClient({ 'get-invoice-by-id': realInvoice });
  const r = await createBitrefill(opts(client)).waitDelivered('inv1');
  assert.equal(r.status, 'delivered');
  assert.equal(r.accessLink, 'https://www.bitrefill.com/account/x#y');
});
