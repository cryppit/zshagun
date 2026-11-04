// Bitrefill through its eCommerce MCP server: stateless JSON-RPC over HTTP, so plain fetch is enough.
// A purchase is one call and is never retried. A second buy after an unclear failure can charge twice.
import { inStock, readPackages } from './finder.mjs';

export class BitrefillError extends Error {
  constructor(message, code = 'UNKNOWN', status = null) {
    super(`Bitrefill: ${message}`);
    this.code = code;
    this.status = status;
  }
}

const parseRpc = (text, type) => {
  if (!type.includes('event-stream')) return JSON.parse(text);
  const data = text.split('\n').filter((l) => l.startsWith('data:')).pop();
  return JSON.parse(data.slice(5));
};

export function createMcpClient({ url, token, fetch = globalThis.fetch }) {
  let nextId = 1;
  async function rpc(method, params) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    });
    if (!res.ok) throw new BitrefillError(`request failed with HTTP ${res.status}`, `HTTP_${res.status}`);
    const body = parseRpc(await res.text(), res.headers.get('content-type') ?? '');
    if (body.error) throw new BitrefillError(body.error.message ?? 'request failed', 'RPC');
    return body.result;
  }
  return {
    rpc,
    async call(name, args) {
      const result = await rpc('tools/call', { name, arguments: args });
      const text = result.content?.[0]?.text ?? '';
      if (result.isError) {
        let e = {};
        try { e = JSON.parse(text); } catch { e = { error: text }; }
        throw new BitrefillError(e.error ?? 'tool failed', e.code, e.details?.status ?? null);
      }
      return text;
    },
  };
}

const field = (text, name) => {
  const m = text.match(new RegExp(`^[\\s-]*${name}: *"?(.+?)"?\\s*$`, 'm'));
  return m ? m[1] : null;
};

// Read tools answer in TOON, a YAML-like text. Only these few fields matter here.
export function readInvoice(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { /* TOON */ }
  if (j) {
    const inv = j.response ?? j;
    const orders = inv.orders ?? [];
    const r = orders.find((o) => o.redemption_info)?.redemption_info ?? {};
    const allDelivered = orders.length > 0 && orders.every((o) => o.status === 'delivered');
    return {
      state: allDelivered ? 'complete' : (inv.invoice_status ?? inv.status), code: r.code ?? null, pin: r.pin ?? null, link: r.link ?? null,
      failed: orders.some((o) => ['failed', 'refunded'].includes(o.status)),
    };
  }
  // TOON. Orders come either as a list or as a table with a header row, so both forms are read.
  const top = text.match(/^\s*(?:- )?invoice_status: *"?(\w+)/m)?.[1] ?? text.match(/^status: *"?(\w+)/m)?.[1] ?? null;
  const listed = [...text.matchAll(/^\s+-?\s*status: *"?(\w+)/gm)].map((m) => m[1]);
  const table = text.match(/^\s*orders\[\d+\]\{([^}]*)\}:\n((?:\s+.+\n?)*)/m);
  const cols = table?.[1].split(',') ?? [];
  const rows = (table?.[2].trim().split('\n') ?? []).filter(Boolean).map((l) => l.trim().split(',').slice(-cols.length));
  const tabled = rows.map((r) => r[cols.indexOf('status')]);
  const refunded = rows.some((r) => r[cols.indexOf('refunded')] === 'true');
  const states = [...listed, ...tabled];
  const allDelivered = /orders_delivery_status: *"?all_delivered/.test(text) || (states.length > 0 && states.every((x) => x === 'delivered'));
  const failed = refunded || states.some((x) => ['failed', 'refunded'].includes(x));
  return { state: allDelivered ? 'complete' : top, code: field(text, 'code'), pin: field(text, 'pin'), link: field(text, 'link'), failed };
}

// Balances sit in BTC, USD and EUR sub-accounts. Product details show each one in rupees.
export function readBalances(text) {
  return text.split(/- payment_method: /).slice(1).map((block) => ({
    method: block.split('\n')[0].trim(),
    currency: block.match(/balance_currency: "?(\w+)/)?.[1] ?? null,
    rupees: Number((block.match(/equivalent_in_product_currency:\s*\n\s*amount: "?([\d.,]+)/)?.[1] ?? '0').replaceAll(',', '')),
  })).filter((b) => b.method === 'balance');
}

const BAD_STATES = ['blocked', 'denied', 'payment_error'];

export function createBitrefill({
  client, log = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now,
  pollMs = 10000, timeoutMs = 180000, packageField = 'package_value', balanceCurrency = null,
}) {
  let fund = balanceCurrency;
  // A rupee figure, from the sub-account with the most in it. Purchases are then paid from that one.
  function pickFund(text) {
    const best = readBalances(text).sort((a, b) => b.rupees - a.rupees)[0];
    if (!best) return 0;
    if (best.rupees > 0 && !balanceCurrency) fund = best.currency;
    return best.rupees;
  }
  return {
    async balance() {
      return pickFund(await client.call('get-product-details', { product_id: 'airtel-india', currency: 'INR' }));
    },
    // Today's price and balance, read right before buying.
    async quote(product) {
      const text = await client.call('get-product-details', { product_id: product.slug ?? product.id, currency: 'INR' });
      const pack = readPackages(text).find((p) => p.value === product.packageValue);
      return { rupees: pack?.rupees ?? null, balance: pickFund(text), inStock: Boolean(pack) && inStock(text) };
    },
    async buy({ product, phone }) {
      const item = { product_id: product.slug ?? product.id, [packageField]: product.packageValue };
      if (phone) item.refill_input = phone.replace(/^\+/, ''); // international format, no plus sign
      const args = { cart_items: [item], payment_method: 'balance' };
      if (fund) args.balance_currency = fund;
      const text = await client.call('buy-products', args);
      let reply;
      try {
        reply = JSON.parse(text);
      } catch {
        throw new BitrefillError('the purchase reply was unreadable, so check the account before doing anything', 'BAD_REPLY');
      }
      const invoiceId = reply.response?.invoice_id ?? reply.invoice_id;
      if (!invoiceId) throw new BitrefillError('the purchase reply had no invoice id, so check the account before doing anything', 'BAD_REPLY');
      log(`bitrefill invoice ${invoiceId} created for ${product.id}`);
      return invoiceId;
    },
    async waitDelivered(invoiceId) {
      const deadline = now() + timeoutMs;
      while (now() < deadline) {
        let inv = null;
        try {
          inv = readInvoice(await client.call('get-invoice-by-id', { invoice_id: invoiceId }));
        } catch (e) {
          log(`bitrefill poll failed for ${invoiceId}: ${e.code}`);
        }
        if (inv?.failed || BAD_STATES.includes(inv?.state)) {
          log(`bitrefill invoice ${invoiceId} failed`);
          return { status: 'needs_human' };
        }
        if (inv?.state === 'complete') {
          log(`bitrefill invoice ${invoiceId} delivered`);
          return { status: 'delivered', code: inv.code, pin: inv.pin, link: inv.link };
        }
        await sleep(pollMs);
      }
      log(`bitrefill invoice ${invoiceId} timed out`);
      return { status: 'needs_human' };
    },
  };
}

// Same shape, buys nothing. Used unless SHAGUN_LIVE=1.
export function createDryBitrefill({ balance = 1000, log = () => {} } = {}) {
  let n = 0;
  return {
    balance: async () => balance,
    quote: async (product) => ({ rupees: product.rupees, balance, inStock: true }),
    buy: async ({ product }) => { log(`dry run: would buy ${product.id}`); return `dry-${++n}`; },
    waitDelivered: async () => ({ status: 'delivered', code: 'DRY-RUN-NOT-A-REAL-CODE', pin: null, link: null }),
  };
}
