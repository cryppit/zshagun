// Read-only: prints the shape of one invoice with every value hidden, so field names can be checked safely.
// node --env-file=../shagun.env scripts/invoice-shape.mjs <invoice id>
import { createMcpClient } from '../src/bitrefill.mjs';

const client = createMcpClient({ url: 'https://api.bitrefill.com/mcp', token: process.env.BITREFILL_API_KEY });
const text = await client.call('get-invoice-by-id', { invoice_id: process.argv[2] });
const start = text.indexOf('orders[');
console.log(text.slice(start).split('\n').map((l) => {
  const m = l.match(/^(\s*(?:- )?[\w[\]{},]+:)(.*)$/);
  return m ? `${m[1]}${m[2].trim() ? ` <${m[2].trim().replace(/^"|"$/g, '').length} chars>` : ''}` : '<row>';
}).join('\n'));
