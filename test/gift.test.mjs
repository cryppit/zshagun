import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newSecret, claimToken, giftId, encryptMessage, decryptMessage,
  buildMemo, parseMemo, paymentUri, tierZat, isRefundAddress,
} from '../web/gift.js';

const UA = 'utest14j43elrxtzx6umn9yzu3pp3tphzgl98gc703xzcs6t8sefhgwhaez9jv2szut7j00v0rfl03cjw0uv9dmcq2zqp3cufu7c2n254dffjfa8qcuyl7usvnktap49cyq343zryet5q5g3dz9rfwyz9a6nuxvwnrnjkzl673sjf2pglk9g5a5nszk4pj3z6z0uez37pfekrpda65sljvdfc';

test('round_trip', async () => {
  const s = newSecret();
  const id = await giftId(s);
  const blob = await encryptMessage(s, 'Happy Diwali, Maa');
  const gift = parseMemo(buildMemo({ id, tier: 51, refundTo: UA, blob }));
  assert.deepEqual(gift, { id, tier: 51, refundTo: UA, blob });
  assert.equal(await decryptMessage(s, gift.blob), 'Happy Diwali, Maa');
});

test('no_refund_address_round_trips_as_null', async () => {
  const s = newSecret();
  const id = await giftId(s);
  const gift = parseMemo(buildMemo({ id, tier: 11, refundTo: null, blob: await encryptMessage(s, '') }));
  assert.equal(gift.refundTo, null);
});

test('under_512_bytes_with_a_full_UA_and_a_120_char_message', async () => {
  const s = newSecret();
  const memo = buildMemo({ id: await giftId(s), tier: 101, refundTo: UA, blob: await encryptMessage(s, 'x'.repeat(120)) });
  assert.ok(new TextEncoder().encode(memo).length <= 512);
});

test('memo_over_512_bytes_throws', async () => {
  const s = newSecret();
  const blob = await encryptMessage(s, 'दीपावली'.repeat(20));
  await assert.rejects(async () => buildMemo({ id: await giftId(s), tier: 11, refundTo: UA, blob }), /too long/);
});

test('junk_is_null', () => {
  const id = 'A'.repeat(43);
  for (const m of [
    '', 'practice', 'CHK1 test order, a long memo to confirm text round trips',
    `SHG2|${id}|11|-|abcd`, `SHG1|short|11|-|abcd`, `SHG1|${id}|10|-|abcd`,
    `SHG1|${id}|11|-`, `SHG1|${id}|11|-|abcd|extra`, `SHG1|${id}|11|-|not base64!`,
  ]) assert.equal(parseMemo(m), null, m);
});

test('bad_refund_address_is_null', () => {
  const id = 'A'.repeat(43);
  const flipped = UA.slice(0, -1) + (UA.endsWith('c') ? 'q' : 'c');
  assert.equal(parseMemo(`SHG1|${id}|11|${flipped}|abcd`), null);
  assert.equal(parseMemo(`SHG1|${id}|11|u1abc|abcd`), null);
  assert.equal(isRefundAddress(UA), true);
  assert.equal(isRefundAddress(flipped), false);
});

test('message_is_unreadable_without_secret', async () => {
  const blob = await encryptMessage(newSecret(), 'a private note');
  assert.ok(!Buffer.from(blob, 'base64url').toString('latin1').includes('private'));
});

test('wrong_secret_fails', async () => {
  const blob = await encryptMessage(newSecret(), 'a private note');
  await assert.rejects(decryptMessage(newSecret(), blob));
});

test('claim_token_cannot_read_the_message', async () => {
  const s = newSecret();
  const token = await claimToken(s);
  assert.notEqual(token, s);
  await assert.rejects(decryptMessage(token, await encryptMessage(s, 'only the link can read this')));
});

test('id_is_the_hash_of_the_claim_token', async () => {
  const s = newSecret();
  const hash = await crypto.subtle.digest('SHA-256', Buffer.from(await claimToken(s), 'base64url'));
  assert.equal(await giftId(s), Buffer.from(hash).toString('base64url'));
});

test('uri_memo_is_base64url', () => {
  const memo = 'SHG1|?>~|11|-|ab';
  const uri = paymentUri({ address: UA, zat: 1000000, memo });
  const u = new URL(uri);
  assert.equal(u.protocol, 'zcash:');
  assert.equal(u.searchParams.get('amount'), '0.01');
  const m = u.searchParams.get('memo');
  assert.match(m, /^[A-Za-z0-9_-]+$/);
  assert.equal(Buffer.from(m, 'base64url').toString(), memo);
});

test('tier_converts_at_the_demo_rate', () => {
  assert.equal(tierZat(11), 1100000);
  assert.equal(tierZat(101), 10100000);
});

test('sealed_phone_opens_only_with_the_agent_key', async () => {
  const { newAgentKey, sealPhone, openPhone } = await import('../web/gift.js');
  const agent = await newAgentKey();
  const other = await newAgentKey();
  const sealed = await sealPhone(agent.publicJwk, '+919876543210');
  assert.ok(!sealed.includes('9876543210'));
  assert.equal(await openPhone(agent.privateJwk, sealed), '+919876543210');
  await assert.rejects(openPhone(other.privateJwk, sealed));
});

test('tiers_end_in_one_as_shagun_does', async () => {
  const { TIERS } = await import('../web/gift.js');
  assert.deepEqual(TIERS, [11, 51, 101]);
});

test('note_carries_sender_and_cover', async () => {
  const { packNote, readNote } = await import('../web/gift.js');
  assert.deepEqual(readNote(packNote({ from: 'Maa', message: 'Happy Diwali', cover: 'wedding' })), { from: 'Maa', message: 'Happy Diwali', cover: 'wedding' });
});

test('an_old_plain_note_still_reads', async () => {
  const { readNote } = await import('../web/gift.js');
  assert.deepEqual(readNote('Happy Diwali, Maa'), { from: '', message: 'Happy Diwali, Maa', cover: 'diwali' });
  assert.deepEqual(readNote('{"not":"ours"}'), { from: '', message: '{"not":"ours"}', cover: 'diwali' });
});

test('an_unknown_cover_falls_back_to_diwali', async () => {
  const { packNote, readNote } = await import('../web/gift.js');
  assert.equal(readNote(packNote({ from: '', message: 'x', cover: '"><script>' })).cover, 'diwali');
  assert.equal(readNote('{"f":"a","m":"b","c":"nope"}').cover, 'diwali');
});

test('longest_note_fits_with_a_full_refund_address', async () => {
  const { packNote } = await import('../web/gift.js');
  const s = newSecret();
  const blob = await encryptMessage(s, packNote({ from: 'x'.repeat(24), message: 'y'.repeat(100), cover: 'birthday' }));
  assert.ok(new TextEncoder().encode(buildMemo({ id: await giftId(s), tier: 101, refundTo: UA, blob })).length <= 512);
});
