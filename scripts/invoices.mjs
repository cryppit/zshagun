// Read-only: the latest paid invoices and the balance, with any code hidden. It cannot buy anything.
// node --env-file=../shagun.env scripts/invoices.mjs
import { createMcpClient } from '../src/bitrefill.mjs';

const client = createMcpClient({ url: 'https://api.bitrefill.com/mcp', token: process.env.BITREFILL_API_KEY });
const hide = (text) => text.replace(/^(\s*-?\s*(?:code|pin|link|barcode_value|refill_input|recipient\w*|phone\w*)):.*$/gim, '$1: [hidden]');
console.log(hide(await client.call('list-invoices', { limit: 3, include_orders: true })).slice(0, 3500));
