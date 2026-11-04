// Read-only: prints the shape of one invoice with every value hidden, so field names can be checked safely.
// node --env-file=../shagun.env scripts/invoice-shape.mjs <invoice id>
import { createMcpClient } from '../src/bitrefill.mjs';

const client = createMcpClient({ url: 'https://api.bitrefill.com/mcp', token: process.env.BITREFILL_API_KEY });
const text = await client.call('get-invoice-by-id', { invoice_id: process.argv[2] });
const start = text.indexOf('orders[');
const block = text.slice(start);
const mask = (v) => `<${v.trim().replace(/^"|"$/g, '').length} chars>`;
console.log(block.split('\n').map((l) => {
  const i = l.trim().startsWith('instructions:');
  if (i) return l.replace(/\d{4,}/g, '<digits>').slice(0, 420);
  const c = l.indexOf(': ');
  if (c > 0) return `${l.slice(0, c)}: ${mask(l.slice(c + 2))}`;
  if (l.trim().endsWith(':')) return l;
  return `<row of ${l.split(',').length} cells, ${l.trim().length} chars>`;
}).join('\n'));
