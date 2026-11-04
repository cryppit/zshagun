import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWallet, parseIncoming } from '../src/wallet.mjs';

const receiver = readFileSync(new URL('./fixtures/list-tx-receiver.txt', import.meta.url), 'utf8');
const payer = readFileSync(new URL('./fixtures/list-tx-payer.txt', import.meta.url), 'utf8');
const TX = 'a'.repeat(64);

test('reads_memo_and_value', () => {
  assert.deepEqual(parseIncoming(receiver)[0], {
    txid: '16a1757b88a3a78a531207fe606c5ca1d08751301dba6c228b11d42b109d4f73',
    output: 4, zat: 1000000, memo: 'practice', height: 4580647,
  });
});

test('memo_with_a_comma', () => {
  assert.equal(parseIncoming(receiver)[1].memo, 'CHK1 test order, a long memo to confirm text round trips');
  assert.equal(parseIncoming(receiver)[1].zat, 40000000);
});

test('unmined_has_null_height', () => {
  const unmined = receiver.replace(/Mined: 4580701 .*/, 'Unmined (expiry height: 4580740)');
  assert.equal(parseIncoming(unmined)[1].height, null);
});

test('change_is_not_incoming', () => {
  const rows = parseIncoming(payer);
  assert.deepEqual(rows.map((r) => r.zat), [100000000]);
});

test('empty_memo_is_an_empty_string', () => {
  assert.equal(parseIncoming(payer)[0].memo, '');
});

test('refresh_syncs_then_enhances', async () => {
  const calls = [];
  const w = createWallet({ exec: async (a) => { calls.push(a); return ''; }, dir: 'W', identity: 'I' });
  await w.refresh();
  assert.deepEqual(calls, [['wallet', '-w', 'W', 'sync'], ['wallet', '-w', 'W', 'enhance']]);
});

test('send_returns_txid', async () => {
  let args;
  const w = createWallet({ exec: async (a) => { args = a; return `Sending transaction...\n${TX}\n`; }, dir: 'W', identity: 'I' });
  assert.equal(await w.send({ address: 'utest1x', zat: 500, memo: 'hi, there' }), TX);
  assert.deepEqual(args, ['wallet', '-w', 'W', 'send', '-i', 'I', '--address', 'utest1x', '--value', '500', '--memo', 'hi, there']);
});

test('send_failure_names_zcash_devtool', async () => {
  const w = createWallet({ exec: async () => { throw new Error('insufficient funds'); }, dir: 'W', identity: 'I' });
  await assert.rejects(w.send({ address: 'a', zat: 1, memo: '' }), /zcash-devtool.*insufficient funds/);
});

test('send_without_a_txid_fails', async () => {
  const w = createWallet({ exec: async () => 'something else', dir: 'W', identity: 'I' });
  await assert.rejects(w.send({ address: 'a', zat: 1, memo: '' }), /zcash-devtool/);
});

test('tip_reads_get_info', async () => {
  const w = createWallet({ exec: async () => '{"chain_tip_height":4581000,"chain_name":"test"}', dir: 'W', identity: 'I' });
  assert.equal(await w.tip(), 4581000);
});

test('commands_run_one_at_a_time', async () => {
  let running = 0, most = 0;
  const exec = async () => {
    running++; most = Math.max(most, running);
    await new Promise((r) => setImmediate(r));
    running--; return receiver;
  };
  const w = createWallet({ exec, dir: 'W', identity: 'I' });
  await Promise.all([w.incoming(), w.incoming(), w.refresh()]);
  assert.equal(most, 1);
});

test('a_failed_command_does_not_block_the_next', async () => {
  let n = 0;
  const exec = async () => { if (n++ === 0) throw new Error('boom'); return receiver; };
  const w = createWallet({ exec, dir: 'W', identity: 'I' });
  await assert.rejects(w.incoming());
  assert.equal((await w.incoming()).length, 2);
});
