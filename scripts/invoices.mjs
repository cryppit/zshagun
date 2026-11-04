// Read-only: the latest paid invoices and the balance, with any code hidden. It cannot buy anything.
// node --env-file=../shagun.env scripts/invoices.mjs
import { createMcpClient } from '../src/bitrefill.mjs';

const client = createMcpClient({ url: 'https://api.bitrefill.com/mcp', token: process.env.BITREFILL_API_KEY });
const hide = (text) => text.replace(/^(\s*-?\s*(?:code|pin|link|barcode_value|refill_input|recipient\w*|phone\w*)):.*$/gim, '$1: [hidden]');
const list = await client.call('list-invoices', { limit: 3, include_orders: true });
console.log(hide(list).slice(0, 3500));
const newest = list.match(/invoice_id: ([0-9a-f-]{36})/)?.[1];
if (newest) console.log(`\n=== newest invoice in full\n${hide(await client.call('get-invoice-by-id', { invoice_id: newest })).slice(0, 3500)}`);
