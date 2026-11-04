// What the page does, without touching the DOM. `api` is { base, fetch }.
import {
  buildMemo, claimToken, decryptMessage, encryptMessage, giftId, isRefundAddress, newSecret, packNote, paymentUri, readNote, sealPhone, tierZat,
} from './gift.js';

export async function makeGift({ tier, message, from, cover, refundTo, agentAddress, pageUrl }) {
  if (refundTo && !isRefundAddress(refundTo)) throw new Error('That refund address does not look right. Check it, or leave it empty.');
  const secret = newSecret();
  const memo = buildMemo({ id: await giftId(secret), tier, refundTo: refundTo || null, blob: await encryptMessage(secret, packNote({ from, message, cover })) });
  const zat = tierZat(tier);
  return { link: `${pageUrl}#${secret}`, memo, zat, uri: paymentUri({ address: agentAddress, zat, memo }) };
}

export function secretFromHash(hash) {
  const s = hash.replace(/^#/, '');
  return /^[A-Za-z0-9_-]{43}$/.test(s) ? s : null;
}

export function indianPhone(text) {
  const digits = text.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

async function call(api, path, init) {
  const res = await api.fetch(`${api.base}${path}`, init);
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  return { status: res.status, body };
}

const down = { screen: 'service_down' };

function fromClaim(body) {
  const { state, code, pin, link, details, instructions, expires, product } = body;
  if (state === 'delivered') {
    if (code || pin || link || details?.length) return { screen: 'done_code', code, pin, link, details, instructions, expires, product };
    return { screen: product?.kind === 'recharge' ? 'done_recharge' : 'already_opened', product };
  }
  if (state === 'buying') return { screen: 'buying', product };
  if (state === 'needs_human') return { screen: 'needs_human' };
  return { screen: 'buying', product };
}

export async function pollClaim(secret, api) {
  try {
    const token = await claimToken(secret);
    const { status, body } = await call(api, `/claim/${await giftId(secret)}`, { headers: { 'x-shagun-token': token } });
    return status === 200 ? fromClaim(body) : down;
  } catch {
    return down;
  }
}

export async function loadGift(hash, api) {
  const secret = secretFromHash(hash);
  if (!secret) return { screen: 'bad_link' };
  let reply;
  try {
    reply = await call(api, `/gift/${await giftId(secret)}`);
  } catch {
    return down;
  }
  if (reply.status === 404) return { screen: 'on_its_way', secret };
  if (reply.status !== 200) return down;
  const { state, tier, blob, choices, key } = reply.body;
  if (state === 'open') {
    try {
      return { screen: 'open', secret, tier, choices, key, ...readNote(await decryptMessage(secret, blob)) };
    } catch {
      return { screen: 'bad_link' };
    }
  }
  if (state === 'already_opened') {
    const claim = await pollClaim(secret, api);
    if (claim.screen === 'done_recharge') return { screen: 'already_opened' };
    return { ...claim, secret };
  }
  if (state === 'buying') return { screen: 'buying', secret };
  return { screen: state, secret };
}

const REFUSALS = {
  already_opened: 'already_opened', over_day_cap: 'limit_reached', below_float_floor: 'limit_reached', service_down: 'service_down',
};

export async function submitClaim({ secret, productId, phone, key }, api) {
  try {
    const sealed = phone ? await sealPhone(key, phone) : undefined;
    const body = JSON.stringify({ id: await giftId(secret), token: await claimToken(secret), productId, phone: sealed });
    const { status, body: reply } = await call(api, '/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    if (status === 202) return { screen: 'buying', secret };
    if (reply.error === 'bad_phone') return { screen: 'choosing', error: 'Check the phone number and try again.' };
    if (status === 429) return { screen: 'choosing', error: 'Too many tries. Wait a minute, then try again.' };
    if (REFUSALS[reply.error]) return { screen: REFUSALS[reply.error] };
    return { screen: 'choosing', error: 'That choice is not available. Pick another.' };
  } catch {
    return down;
  }
}

export async function markSeen(secret, api) {
  try {
    await call(api, `/claim/${await giftId(secret)}/seen`, { method: 'POST', headers: { 'x-shagun-token': await claimToken(secret) } });
  } catch { /* the agent wipes it within the hour anyway */ }
}
