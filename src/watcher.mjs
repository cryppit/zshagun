// One pass: find new gifts, fund the good ones, send back the rest. Run on a timer by main.mjs.
import { parseMemo } from '../web/gift.js';
import { checkGift } from './guard.mjs';

export const REFUND_FEE_ZAT = 10000; // the network fee for sending it back comes out of the refund

const REFUND_MEMO = {
  refused: 'Your Shagun could not be accepted, so it has come back to you.',
  expired: 'Your Shagun was not opened in time, so it has come back to you.',
};

async function refund(ctx, gift, why) {
  const { ledger, wallet, log } = ctx;
  if (!gift.refund_to || gift.zat <= REFUND_FEE_ZAT) {
    ledger.setState(gift.id, why);
    return;
  }
  // Marked before sending: a crash here leaves "needs a human", never a second refund.
  ledger.setState(gift.id, 'refunding');
  try {
    const txid = await wallet.send({ address: gift.refund_to, zat: gift.zat - REFUND_FEE_ZAT, memo: REFUND_MEMO[why] });
    ledger.setState(gift.id, 'refunded', { refund_txid: txid });
    log(`gift ${gift.id.slice(0, 8)} refunded (${why})`);
  } catch (e) {
    ledger.setState(gift.id, 'needs_human', { note: `refund failed: ${e.message}` });
    log(`gift ${gift.id.slice(0, 8)} needs a human: refund failed`);
  }
}

export async function watch(ctx) {
  const { wallet, ledger, limits, now, expireMs, confirmations, log } = ctx;
  await wallet.refresh();
  const [rows, tip] = [await wallet.incoming(), await wallet.tip()];

  for (const row of rows) {
    const memo = parseMemo(row.memo);
    if (!memo) continue;
    const added = ledger.addGift({ ...memo, txid: row.txid, output: row.output, zat: row.zat, height: row.height, now: now() });
    if (added) log(`gift ${memo.id.slice(0, 8)} seen`);
    const gift = ledger.get(memo.id);
    if (gift.txid !== row.txid || gift.output !== row.output) continue;
    if (!['seen', 'mined'].includes(gift.state) || row.height === null) continue;

    if (tip - row.height + 1 < confirmations) {
      ledger.setState(gift.id, 'mined', { height: row.height });
      continue;
    }
    const verdict = checkGift({ tier: gift.tier, zat: gift.zat, spentToday: ledger.spentToday(now()), limits });
    if (verdict.ok) {
      ledger.setState(gift.id, 'confirmed', { height: row.height });
      log(`gift ${gift.id.slice(0, 8)} confirmed`);
    } else {
      log(`gift ${gift.id.slice(0, 8)} refused: ${verdict.reason}`);
      await refund(ctx, gift, 'refused');
    }
  }

  for (const gift of ledger.inState('confirmed')) {
    if (now() - gift.created_at >= expireMs) await refund(ctx, gift, 'expired');
  }
}
