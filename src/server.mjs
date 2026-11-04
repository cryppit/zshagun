// The claim API. No log line here ever holds a token, phone number, code or IP.
import http from 'node:http';
import { idFromToken, openPhone } from '../web/gift.js';
import { checkClaim } from './guard.mjs';
import { REFUND_FEE_ZAT } from './watcher.mjs';

const ZAT_PER_RUPEE = 100000;
const MAX_BODY = 8192;

const PUBLIC_STATE = {
  seen: 'on_its_way', mined: 'on_its_way', confirmed: 'open', claimed: 'buying', buying: 'buying', delivered: 'already_opened',
  expired: 'expired', refunding: 'expired', refunded: 'expired', refused: 'refused', needs_human: 'needs_human',
};

const short = (id) => id.slice(0, 8);

async function tokenMatches(token, id) {
  try {
    return typeof token === 'string' && (await idFromToken(token)) === id;
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) reject(new Error('too big'));
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

export function createApp({ ledger, bitrefill, wallet, catalog, limits, agentKey, now, log, origins, claimsPerMinute = 10 }) {
  const products = () => (typeof catalog === 'function' ? catalog() : catalog);
  const pending = new Set();
  const track = (p) => { pending.add(p); p.finally(() => pending.delete(p)); return p; };

  const hits = new Map();
  function limited(req) {
    const ip = req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress;
    const minute = Math.floor(now() / 60000);
    const entry = hits.get(ip);
    if (!entry || entry.minute !== minute) {
      if (hits.size > 10000) hits.clear();
      hits.set(ip, { minute, count: 1 });
      return false;
    }
    entry.count += 1;
    return entry.count > claimsPerMinute;
  }

  async function tellGiver(id) {
    const gift = ledger.get(id);
    if (!gift.refund_to) return;
    const rest = Math.round(gift.zat - gift.rupees * ZAT_PER_RUPEE - REFUND_FEE_ZAT);
    try {
      const txid = await wallet.send({
        address: gift.refund_to, zat: Math.max(rest, REFUND_FEE_ZAT), memo: 'Your Shagun was opened. Anything left over is in this payment.',
      });
      ledger.setState(id, 'delivered', { opened_txid: txid });
      log(`gift ${short(id)} giver told`);
    } catch {
      log(`gift ${short(id)} opened memo failed: zcash-devtool`);
    }
  }

  async function finish(id) {
    const { invoice_id: invoice } = ledger.get(id);
    const result = await bitrefill.waitDelivered(invoice);
    if (result.status !== 'delivered') {
      ledger.setState(id, 'needs_human', { note: `invoice ${invoice} not delivered` });
      log(`gift ${short(id)} needs a human`);
      return;
    }
    const { code, pin, link } = result;
    const secret = code || pin || link ? JSON.stringify({ code, pin, link }) : null;
    ledger.setState(id, 'delivered', { code: secret, delivered_at: now() });
    if (!secret) ledger.forget(id);
    else ledger.setState(id, 'delivered', { phone: null });
    log(`gift ${short(id)} delivered`);
    await tellGiver(id);
  }

  async function fulfil(id, product, phone) {
    let invoice;
    try {
      invoice = await bitrefill.buy({ product, phone });
    } catch (e) {
      ledger.setState(id, 'needs_human', { note: e.message });
      log(`gift ${short(id)} needs a human: the purchase failed`);
      return;
    }
    ledger.setState(id, 'buying', { invoice_id: invoice });
    await finish(id);
  }

  async function claim(req, send) {
    if (limited(req)) return send(429, { error: 'too_many', message: 'Too many tries. Wait a minute.' });
    let body;
    try { body = await readBody(req); } catch { return send(400, { error: 'bad_request' }); }
    const { id, token, productId, phone: sealed } = body;
    if (typeof id !== 'string' || !(await tokenMatches(token, id))) return send(403, { error: 'wrong_secret' });
    const gift = ledger.get(id);
    if (!gift) return send(404, { error: 'unknown_gift' });
    if (gift.state !== 'confirmed') return send(409, { error: 'already_opened', state: PUBLIC_STATE[gift.state] });

    const wanted = products().find((p) => p.id === productId);
    if (!wanted) return send(409, { error: 'product_not_listed' });
    let phone = null;
    if (wanted.needsPhone) {
      try { phone = await openPhone(agentKey.privateJwk, sealed); } catch { phone = null; }
      if (!/^\+?\d{10,15}$/.test(phone ?? '')) return send(400, { error: 'bad_phone', message: 'Check the phone number.' });
    }

    let quote;
    try {
      quote = await bitrefill.quote(wanted);
    } catch (e) {
      log(`claim paused: ${e.code ?? 'Bitrefill'} price check failed`);
      return send(503, { error: 'service_down', message: 'Bitrefill is not answering. Your gift is safe. Try again in a minute.' });
    }
    if (!quote.inStock) {
      log(`gift ${short(id)} claim refused: out_of_stock`);
      return send(409, { error: 'out_of_stock' });
    }
    const priced = products().map((p) => (p.id === productId ? { ...p, rupees: quote.rupees } : p));

    // No await from here to claimOnce, so two taps can't both pass the limits.
    const verdict = checkClaim({ tier: gift.tier, productId, catalog: priced, spentToday: ledger.spentToday(now()), balance: quote.balance, limits });
    if (!verdict.ok) {
      log(`gift ${short(id)} claim refused: ${verdict.reason}`);
      return send(409, { error: verdict.reason });
    }
    const sealedOrNull = wanted.needsPhone ? sealed : null;
    if (!ledger.claimOnce(id, { productId, phone: sealedOrNull, rupees: verdict.product.rupees, now: now() })) {
      return send(409, { error: 'already_opened' });
    }
    log(`gift ${short(id)} claimed`);
    track(fulfil(id, verdict.product, phone));
    return send(202, { claimId: id });
  }

  async function status(req, id, send) {
    if (!(await tokenMatches(req.headers['x-shagun-token'], id))) return send(403, { error: 'wrong_secret' });
    const gift = ledger.get(id);
    if (!gift) return send(404, { error: 'unknown_gift' });
    const product = products().find((p) => p.id === gift.product_id);
    const state = gift.state === 'delivered' ? 'delivered' : PUBLIC_STATE[gift.state];
    const out = { state, product: product ? { name: product.name, label: product.label, kind: product.kind } : null };
    return send(200, gift.code ? { ...out, ...JSON.parse(gift.code) } : out);
  }

  async function seen(req, id, send) {
    if (!(await tokenMatches(req.headers['x-shagun-token'], id))) return send(403, { error: 'wrong_secret' });
    if (ledger.get(id)?.state === 'delivered') ledger.forget(id);
    return send(204);
  }

  function publicGift(id, send) {
    const gift = ledger.get(id);
    if (!gift) return send(404, { error: 'unknown_gift' });
    const choices = products().filter((p) => p.rupees <= gift.tier)
      .map(({ id: pid, name, label, kind, needsPhone }) => ({ id: pid, name, label, kind, needsPhone }));
    return send(200, { tier: gift.tier, state: PUBLIC_STATE[gift.state], blob: gift.blob, choices, key: agentKey.publicJwk });
  }

  const server = http.createServer(async (req, res) => {
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
    if (origins.includes(req.headers.origin)) {
      headers['access-control-allow-origin'] = req.headers.origin;
      headers['access-control-allow-headers'] = 'content-type, x-shagun-token';
      headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
      headers.vary = 'origin';
    }
    const send = (code, body) => { res.writeHead(code, headers); res.end(body === undefined ? undefined : JSON.stringify(body)); };
    const path = new URL(req.url, 'http://x').pathname;
    let m;
    try {
      if (req.method === 'OPTIONS') return send(204);
      if (req.method === 'GET' && path === '/health') return send(200, { ok: true });
      if (req.method === 'GET' && (m = path.match(/^\/gift\/([\w-]+)$/))) return publicGift(m[1], send);
      if (req.method === 'POST' && path === '/claim') return await claim(req, send);
      if (req.method === 'GET' && (m = path.match(/^\/claim\/([\w-]+)$/))) return await status(req, m[1], send);
      if (req.method === 'POST' && (m = path.match(/^\/claim\/([\w-]+)\/seen$/))) return await seen(req, m[1], send);
      return send(404, { error: 'not_found' });
    } catch {
      log('request failed');
      return send(500, { error: 'server_error' });
    }
  });

  return {
    server,
    settled: async () => { while (pending.size) await Promise.allSettled([...pending]); },
    async recover() {
      for (const g of ledger.inState('claimed', 'refunding')) {
        ledger.setState(g.id, 'needs_human', { note: `stopped during ${g.state}` });
        log(`gift ${short(g.id)} needs a human: stopped during ${g.state}`);
      }
      for (const g of ledger.inState('buying')) track(finish(g.id));
    },
  };
}
