// The gift format, shared by the page and the agent. No dependencies, runs in browsers and Node.
//
// The link holds a secret S. Two keys come out of it:
//   claim token T = HKDF(S, "claim"). The recipient's page sends T to claim. id = SHA-256(T).
//   message key   = HKDF(S, "message"). Never leaves the browser, so the agent can't read the message, even at claim time.

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;

export const TIERS = [11, 51, 101]; // shagun traditionally ends in 1
export const MAX_MEMO_BYTES = 512;
const ZAT_PER_RUPEE = 100000; // demo rate: 1 TAZ = ₹1,000

export function toB64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromB64url(text) {
  const s = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function derive(secret, label) {
  const key = await subtle.importKey('raw', fromB64url(secret), 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(`shagun ${label} v1`) }, key, 256);
  return new Uint8Array(bits);
}

async function messageKey(secret, use) {
  return subtle.importKey('raw', await derive(secret, 'message'), 'AES-GCM', false, [use]);
}

export function newSecret() {
  return toB64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function claimToken(secret) {
  return toB64url(await derive(secret, 'claim'));
}

export async function idFromToken(token) {
  return toB64url(new Uint8Array(await subtle.digest('SHA-256', fromB64url(token))));
}

export async function giftId(secret) {
  return idFromToken(await claimToken(secret));
}

export async function encryptMessage(secret, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, await messageKey(secret, 'encrypt'), enc.encode(text));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), 12);
  return toB64url(out);
}

export async function decryptMessage(secret, blob) {
  const raw = fromB64url(blob);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await messageKey(secret, 'decrypt'), raw.slice(12));
  return dec.decode(pt);
}

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function polymod(values) {
  const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= gen[i];
  }
  return chk >>> 0;
}

// A testnet unified address with a good bech32m checksum.
export function isRefundAddress(address) {
  if (typeof address !== 'string' || !address.startsWith('utest1') || address.length < 60) return false;
  const hrp = 'utest';
  const data = [...address.slice(hrp.length + 1)].map((c) => CHARSET.indexOf(c));
  if (data.includes(-1)) return false;
  const expanded = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat(0, [...hrp].map((c) => c.charCodeAt(0) & 31));
  return polymod(expanded.concat(data)) === 0x2bc830a3;
}

export function buildMemo({ id, tier, refundTo, blob }) {
  const memo = `SHG1|${id}|${tier}|${refundTo ?? '-'}|${blob}`;
  if (enc.encode(memo).length > MAX_MEMO_BYTES) throw new Error('memo too long: shorten the message');
  return memo;
}

export function parseMemo(text) {
  const parts = text.split('|');
  if (parts.length !== 5 || parts[0] !== 'SHG1') return null;
  const [, id, tierText, refund, blob] = parts;
  const tier = Number(tierText);
  if (!/^[A-Za-z0-9_-]{43}$/.test(id) || !TIERS.includes(tier) || String(tier) !== tierText) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(blob)) return null;
  if (refund !== '-' && !isRefundAddress(refund)) return null;
  return { id, tier, refundTo: refund === '-' ? null : refund, blob };
}

export function tierZat(tier) {
  return tier * ZAT_PER_RUPEE;
}

// ZIP 321 payment request.
export function paymentUri({ address, zat, memo }) {
  const whole = String(Math.floor(zat / 1e8));
  const frac = String(zat % 1e8).padStart(8, '0').replace(/0+$/, '');
  const amount = frac ? `${whole}.${frac}` : whole;
  return `zcash:${address}?amount=${amount}&memo=${toB64url(enc.encode(memo))}`;
}

// The phone number is sealed to the agent's key in the browser, so the tunnel in between can't read it.
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

async function sharedKey(privateKey, publicKey, use) {
  const bits = await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('shagun phone v1') },
    hkdf, { name: 'AES-GCM', length: 256 }, false, [use]);
}

export async function newAgentKey() {
  const pair = await subtle.generateKey(ECDH, true, ['deriveBits']);
  return { publicJwk: await subtle.exportKey('jwk', pair.publicKey), privateJwk: await subtle.exportKey('jwk', pair.privateKey) };
}

export async function sealPhone(publicJwk, phone) {
  const agent = await subtle.importKey('jwk', publicJwk, ECDH, false, []);
  const mine = await subtle.generateKey(ECDH, true, ['deriveBits']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, await sharedKey(mine.privateKey, agent, 'encrypt'), enc.encode(phone));
  const pub = new Uint8Array(await subtle.exportKey('raw', mine.publicKey));
  return [pub, iv, new Uint8Array(ct)].map(toB64url).join('.');
}

export async function openPhone(privateJwk, sealed) {
  const [pub, iv, ct] = sealed.split('.').map(fromB64url);
  const agent = await subtle.importKey('jwk', privateJwk, ECDH, false, ['deriveBits']);
  const theirs = await subtle.importKey('raw', pub, ECDH, false, []);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, await sharedKey(agent, theirs, 'decrypt'), ct);
  return dec.decode(pt);
}
