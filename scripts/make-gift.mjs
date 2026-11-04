// Pays a gift from the demo giver's wallet and prints the link, for handing out at the venue.
// node scripts/make-gift.mjs <11|51|101> "message"
import { homedir } from 'node:os';
import { join } from 'node:path';
import { makeGift } from '../web/flow.js';
import { config } from '../web/config.js';
import { createWallet, realExec } from '../src/wallet.mjs';

const fsh = process.env.SHAGUN_HOME ?? join(homedir(), 'fsh');
const payerAddress = 'utest1h30pu0a9dhv84maw06vgxjtr88vzhg58dxhxm06h0ll9agd0kl8p8k3ryt2ptc4zt4d0p09wkqf7hfy5e3lpajfgvvzs7z9r9gc04e2r47ddr424lemh60ds0xmp0pavxeud3rshcl65xfn67z8rerexhmmmtnvgp64gwzhac6edtkzwck4rf7ruum0vfsjvwl80h3c9ctnyjsdg2hw';
const tier = Number(process.argv[2]);
const message = process.argv[3] ?? 'Happy Diwali!';

const wallet = createWallet({
  exec: realExec(join(fsh, 'zcash-devtool/target/release/zcash-devtool')),
  dir: join(fsh, 'wallets/payer'),
  identity: join(fsh, 'wallets/payer.age'),
});
const gift = await makeGift({
  tier, message, refundTo: payerAddress, agentAddress: config.agentAddress, pageUrl: 'https://cryppit.github.io/shagun/',
});
await wallet.refresh();
const txid = await wallet.send({ address: config.agentAddress, zat: gift.zat, memo: gift.memo });
console.log(`txid ${txid}`);
console.log(gift.link);
