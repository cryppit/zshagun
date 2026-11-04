// Bitrefill through its eCommerce MCP server: stateless JSON-RPC over HTTP, so plain fetch is enough.
// A purchase is one call and is never retried. A second buy after an unclear failure can charge twice.

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
  try {
    const j = JSON.parse(text);
    const orders = j.orders ?? [];
    const r = orders.find((o) => o.redemption_info)?.redemption_info ?? {};
    return {
      state: j.status, code: r.code ?? null, pin: r.pin ?? null, link: r.link ?? null,
      failed: orders.some((o) => ['failed', 'refunded'].includes(o.status)),
    };
  } catch {
    return {
      state: field(text, 'status'), code: field(text, 'code'), pin: field(text, 'pin'), link: field(text, 'link'),
      failed: /status: *"?(failed|refunded)\b/.test(text),
    };
  }
}

const BAD_STATES = ['blocked', 'denied', 'payment_error'];

export function createBitrefill({
  client, log = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now,
  pollMs = 3000, timeoutMs = 120000, packageField = 'package_value', balanceCurrency = null,
}) {
  return {
    async balance() {
      return client.call('get-balances', {});
    },
    async buy({ product, phone }) {
      const item = { product_id: product.id, [packageField]: product.packageValue };
      if (phone) item.refill_input = phone;
      const args = { cart_items: [item], payment_method: 'balance' };
      if (balanceCurrency) args.balance_currency = balanceCurrency;
      const reply = JSON.parse(await client.call('buy-products', args));
      log(`bitrefill invoice ${reply.invoice_id} created for ${product.id}`);
      return reply.invoice_id;
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
    buy: async ({ product }) => { log(`dry run: would buy ${product.id}`); return `dry-${++n}`; },
    waitDelivered: async () => ({ status: 'delivered', code: 'DRY-RUN-NOT-A-REAL-CODE', pin: null, link: null }),
  };
}
