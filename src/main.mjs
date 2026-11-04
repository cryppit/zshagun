// One process: the watcher on a timer and the claim API. Buys nothing unless SHAGUN_LIVE=1.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { newAgentKey } from '../web/gift.js';
import { createBitrefill, createDryBitrefill, createMcpClient } from './bitrefill.mjs';
import { findProducts } from './finder.mjs';
import { createLedger } from './ledger.mjs';
import { createApp } from './server.mjs';
import { watch } from './watcher.mjs';
import { createWallet, realExec } from './wallet.mjs';

const env = process.env;
const fsh = env.SHAGUN_HOME ?? join(homedir(), 'fsh');
const port = Number(env.PORT ?? 8791);
const live = env.SHAGUN_LIVE === '1';
const log = (line) => console.log(`${new Date().toISOString()} ${line}`);

const limits = { perGift: 101, perDay: 300, floor: Number(env.SHAGUN_FLOOR ?? 0) };
const { brands, products: fixedList } = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url)));
let products = fixedList;

const keyPath = join(fsh, 'shagun-agent-key.json');
if (!existsSync(keyPath)) writeFileSync(keyPath, JSON.stringify(await newAgentKey()), { mode: 0o600 });
const agentKey = JSON.parse(readFileSync(keyPath, 'utf8'));

const ledger = createLedger(env.SHAGUN_LEDGER ?? join(fsh, 'shagun-ledger.sqlite'));
const wallet = createWallet({
  exec: realExec(join(fsh, 'zcash-devtool/target/release/zcash-devtool')),
  dir: join(fsh, 'wallets/receiver'),
  identity: join(fsh, 'wallets/receiver.age'),
});

let bitrefill;
let refreshProducts = async () => {};
if (live) {
  if (!env.BITREFILL_API_KEY) throw new Error('SHAGUN_LIVE=1 needs BITREFILL_API_KEY');
  const client = createMcpClient({ url: 'https://api.bitrefill.com/mcp', token: env.BITREFILL_API_KEY });
  bitrefill = createBitrefill({
    client, log, packageField: env.SHAGUN_PACKAGE_FIELD ?? 'package_value', balanceCurrency: env.SHAGUN_BALANCE_CURRENCY ?? null,
  });
  refreshProducts = async () => {
    const found = await findProducts({ client, brands, maxRupees: limits.perGift, perBrand: 3, log });
    if (found.length) products = found;
    log(`found ${found.length} products under ₹${limits.perGift}`);
  };
} else {
  bitrefill = createDryBitrefill({ log });
}

const app = createApp({
  ledger, bitrefill, wallet, catalog: () => products, limits, agentKey, now: Date.now, log,
  origins: ['https://cryppit.github.io', 'http://localhost:8080'],
});
await refreshProducts();
setInterval(() => refreshProducts().catch(() => log('product refresh failed')), 30 * 60 * 1000);
await app.recover();
if (live) {
  try {
    log(`balance ₹${await bitrefill.balance()}`);
  } catch (e) {
    log(`balance check failed: ${e.message}`);
  }
}
app.server.listen(port, '127.0.0.1', () => log(`zshagun on :${port}, ${live ? 'LIVE' : 'dry run'}`));

const ctx = { wallet, ledger, limits, now: Date.now, log, confirmations: 1, expireMs: 24 * 3600 * 1000 };
async function loop() {
  try {
    await watch(ctx);
  } catch (e) {
    log(`watcher: ${e.message}`);
  }
  setTimeout(loop, 15000);
}
loop();
