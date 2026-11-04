// Puts a delivered gift's full card details back on its page, from its Bitrefill invoice. It reads the invoice and buys nothing.
// It prints only a count, never a value. node --env-file=../shagun.env scripts/refetch-gift.mjs <first letters of the gift id>
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createMcpClient, readInvoice } from '../src/bitrefill.mjs';
import { createLedger } from '../src/ledger.mjs';

const ledger = createLedger(join(process.env.SHAGUN_HOME ?? join(homedir(), 'fsh'), 'shagun-ledger.sqlite'));
const gift = ledger.all().find((g) => g.id.startsWith(process.argv[2]));
if (gift?.state !== 'delivered' || !gift.invoice_id) throw new Error('no delivered gift with an invoice has that id');
const client = createMcpClient({ url: 'https://api.bitrefill.com/mcp', token: process.env.BITREFILL_API_KEY });
const inv = readInvoice(await client.call('get-invoice-by-id', { invoice_id: gift.invoice_id }));
ledger.setState(gift.id, 'delivered', {
  code: JSON.stringify({ details: inv.details, link: inv.link, instructions: inv.instructions, expires: inv.expires }),
  delivered_at: Date.now(),
});
console.log(`${inv.details.length} card fields are back on the gift page. They wipe after you tap "I've saved it", or in an hour.`);
