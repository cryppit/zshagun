import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGift, secretFromHash, loadGift, submitClaim, pollClaim, indianPhone } from './flow.js';
import { screen, esc } from './views.js';
import { claimToken, giftId, encryptMessage, newAgentKey, newSecret, openPhone, parseMemo } from './gift.js';

const UA = 'utest14j43elrxtzx6umn9yzu3pp3tphzgl98gc703xzcs6t8sefhgwhaez9jv2szut7j00v0rfl03cjw0uv9dmcq2zqp3cufu7c2n254dffjfa8qcuyl7usvnktap49cyq343zryet5q5g3dz9rfwyz9a6nuxvwnrnjkzl673sjf2pglk9g5a5nszk4pj3z6z0uez37pfekrpda65sljvdfc';
const PAGE = 'https://cryppit.github.io/shagun/';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function aGift(over = {}) {
  const secret = newSecret();
  const gift = { tier: 11, state: 'open', blob: await encryptMessage(secret, 'Happy <b>Diwali</b>'), choices: [], key: {}, ...over };
  return { secret, gift };
}
const api = (handler) => ({ base: 'https://agent.test', fetch: async (url, init) => handler(url, init) });

test('give_makes_link_and_memo_that_parse', async () => {
  const g = await makeGift({ tier: 51, message: 'Shubh Deepavali', refundTo: UA, agentAddress: UA, pageUrl: PAGE });
  const secret = secretFromHash(new URL(g.link).hash);
  const memo = parseMemo(g.memo);
  assert.equal(memo.tier, 51);
  assert.equal(memo.id, await giftId(secret));
  assert.equal(g.zat, 5100000);
  assert.match(g.uri, /^zcash:utest1/);
});

test('secret_only_in_fragment', async () => {
  const g = await makeGift({ tier: 11, message: 'hi', refundTo: null, agentAddress: UA, pageUrl: PAGE });
  const u = new URL(g.link);
  const secret = u.hash.slice(1);
  assert.equal(u.search, '');
  assert.ok(!(u.origin + u.pathname).includes(secret));
  assert.ok(!g.memo.includes(secret));
  assert.ok(!g.uri.includes(secret));
});

test('bad_refund_address_is_refused_at_giving', async () => {
  await assert.rejects(makeGift({ tier: 11, message: '', refundTo: 'utest1nope', agentAddress: UA, pageUrl: PAGE }), /refund address/);
});

test('mangled_links_read_as_null', () => {
  for (const h of ['', '#', '#short', `#${'A'.repeat(42)}`, `#${'A'.repeat(44)}`, `#${'A'.repeat(42)}!`, '#%20']) {
    assert.equal(secretFromHash(h), null, h);
  }
  assert.equal(secretFromHash(`#${'A'.repeat(43)}`), 'A'.repeat(43));
});

test('bad_link_is_plain', async () => {
  const s = await loadGift('#nope', api(() => { throw new Error('should not call'); }));
  assert.equal(s.screen, 'bad_link');
  assert.match(screen(s), /link/i);
  assert.doesNotMatch(screen(s), /undefined|Error|null/);
});

test('on_its_way_before_mined', async () => {
  const s = await loadGift(`#${newSecret()}`, api(() => json(404, { error: 'unknown_gift' })));
  assert.equal(s.screen, 'on_its_way');
});

test('seen_but_unconfirmed_is_on_its_way', async () => {
  const { secret, gift } = await aGift({ state: 'on_its_way' });
  const s = await loadGift(`#${secret}`, api(() => json(200, gift)));
  assert.equal(s.screen, 'on_its_way');
});

test('open_gift_decrypts_in_the_browser', async () => {
  const { secret, gift } = await aGift();
  const s = await loadGift(`#${secret}`, api(() => json(200, gift)));
  assert.equal(s.screen, 'open');
  assert.equal(s.message, 'Happy <b>Diwali</b>');
});

test('message_is_escaped', async () => {
  const { secret, gift } = await aGift();
  const html = screen(await loadGift(`#${secret}`, api(() => json(200, gift))));
  assert.ok(!html.includes('<b>Diwali'));
  assert.ok(html.includes('&lt;b&gt;Diwali'));
  assert.equal(esc(`"'&`), '&quot;&#39;&amp;');
});

test('service_down_names_the_service', async () => {
  const s = await loadGift(`#${newSecret()}`, api(() => { throw new TypeError('failed'); }));
  assert.equal(s.screen, 'service_down');
  assert.match(screen(s), /Shagun/);
  assert.match(screen(s), /safe/i);
});

test('server_error_is_service_down', async () => {
  const s = await loadGift(`#${newSecret()}`, api(() => json(502, {})));
  assert.equal(s.screen, 'service_down');
});

test('wrong_message_key_is_a_bad_link', async () => {
  const { gift } = await aGift();
  const s = await loadGift(`#${newSecret()}`, api(() => json(200, gift)));
  assert.equal(s.screen, 'bad_link');
});

test('reload_after_opening_shows_the_code', async () => {
  const { secret, gift } = await aGift({ state: 'already_opened' });
  const s = await loadGift(`#${secret}`, api((url) => (url.includes('/claim/')
    ? json(200, { state: 'delivered', code: 'C-1', product: { name: 'Amazon', kind: 'card', rupees: 10 } })
    : json(200, gift))));
  assert.equal(s.screen, 'done_code');
  assert.match(screen(s), /C-1/);
});

test('second_phone_sees_already_opened', async () => {
  const { secret, gift } = await aGift({ state: 'already_opened' });
  const s = await loadGift(`#${secret}`, api((url) => (url.includes('/claim/')
    ? json(200, { state: 'delivered', product: { name: 'Amazon', kind: 'card', rupees: 10 } })
    : json(200, gift))));
  assert.equal(s.screen, 'already_opened');
});

test('refused_expired_and_needs_human_have_their_own_screens', async () => {
  for (const state of ['expired', 'refused', 'needs_human']) {
    const { secret, gift } = await aGift({ state });
    const s = await loadGift(`#${secret}`, api(() => json(200, gift)));
    assert.equal(s.screen, state);
    assert.ok(screen(s).length > 40);
  }
});

test('phone_encrypted_before_sending', async () => {
  const agent = await newAgentKey();
  const secret = newSecret();
  let sent;
  const a = api((url, init) => { sent = init.body; return json(202, { claimId: 'x' }); });
  const r = await submitClaim({ secret, productId: 'p', phone: '+919876543210', key: agent.publicJwk }, a);
  assert.equal(r.screen, 'buying');
  assert.ok(!sent.includes('9876543210'));
  assert.ok(!sent.includes(secret));
  const body = JSON.parse(sent);
  assert.equal(body.token, await claimToken(secret));
  assert.equal(await openPhone(agent.privateJwk, body.phone), '+919876543210');
});

test('claim_refusals_are_plain', async () => {
  const cases = { already_opened: 'already_opened', bad_phone: 'choosing', over_day_cap: 'limit_reached', below_float_floor: 'limit_reached', service_down: 'service_down' };
  for (const [error, want] of Object.entries(cases)) {
    const r = await submitClaim({ secret: newSecret(), productId: 'p', phone: null, key: null }, api(() => json(409, { error })));
    assert.equal(r.screen, want, error);
  }
});

test('poll_shows_recharge_or_code', async () => {
  const secret = newSecret();
  const product = { name: 'Airtel', kind: 'recharge', rupees: 10 };
  assert.equal((await pollClaim(secret, api(() => json(200, { state: 'buying', product })))).screen, 'buying');
  assert.equal((await pollClaim(secret, api(() => json(200, { state: 'delivered', product })))).screen, 'done_recharge');
  assert.equal((await pollClaim(secret, api(() => json(200, { state: 'delivered', code: 'X', product })))).screen, 'done_code');
  assert.equal((await pollClaim(secret, api(() => json(200, { state: 'needs_human' })))).screen, 'needs_human');
});

test('indian_phone', () => {
  assert.equal(indianPhone('98765 43210'), '+919876543210');
  assert.equal(indianPhone('+91 98765-43210'), '+919876543210');
  assert.equal(indianPhone('09876543210'), '+919876543210');
  assert.equal(indianPhone('12345'), null);
  assert.equal(indianPhone('1234567890'), null);
});

test('every_screen_renders_without_gaps', () => {
  const data = { screen: '', tier: 11, message: '', choices: [{ id: 'a', name: 'A', kind: 'card', rupees: 10, needsPhone: false }], product: { name: 'A', kind: 'card', rupees: 10 }, code: 'C', zat: 1000000, link: PAGE, uri: 'zcash:x', qr: '' };
  for (const name of ['give', 'pay', 'share', 'on_its_way', 'open', 'choosing', 'buying', 'done_recharge', 'done_code', 'already_opened', 'expired', 'refused', 'needs_human', 'limit_reached', 'service_down', 'bad_link']) {
    const html = screen({ ...data, screen: name });
    assert.ok(html.length > 40, name);
    assert.doesNotMatch(html, /undefined|\bnull\b|NaN/, name);
  }
});

test('recipient_screens_have_no_crypto_words', () => {
  const data = { tier: 11, message: 'hi', choices: [], product: { name: 'A', kind: 'card', rupees: 10 }, code: 'C' };
  for (const name of ['on_its_way', 'open', 'choosing', 'buying', 'done_recharge', 'done_code', 'already_opened', 'needs_human', 'service_down']) {
    assert.doesNotMatch(screen({ ...data, screen: name }), /crypto|wallet|zcash|zec\b|blockchain|shielded|token/i, name);
  }
});

test('pay_screen_shows_the_exact_amount', () => {
  assert.match(screen({ screen: 'pay', zat: 5100000, uri: 'zcash:x', qr: '' }), /0\.051 TAZ/);
  assert.match(screen({ screen: 'pay', zat: 1100000, uri: 'zcash:x', qr: '' }), /0\.011 TAZ/);
  assert.match(screen({ screen: 'pay', zat: 10100000, uri: 'zcash:x', qr: '' }), /0\.101 TAZ/);
});
