// Read-only look at Bitrefill: the buy tool's schema, the balance and the India catalog. It cannot buy anything.
// node --env-file=../shagun.env scripts/peek.mjs > ../peek.txt
import { createMcpClient } from '../src/bitrefill.mjs';

const client = createMcpClient({ url: 'https://api.bitrefill.com/mcp', token: process.env.BITREFILL_API_KEY });
const safe = async (label, fn) => {
  try { console.log(`\n=== ${label}\n${await fn()}`); } catch (e) { console.log(`\n=== ${label} FAILED: ${e.message}`); }
};

await safe('tools', async () => {
  const { tools } = await client.rpc('tools/list');
  const pick = (n) => JSON.stringify(tools.find((t) => t.name === n)?.inputSchema);
  return [tools.map((t) => t.name).join(' '), `buy-products ${pick('buy-products')}`,
    `get-invoice-by-id ${pick('get-invoice-by-id')}`, `get-balances ${pick('get-balances')}`].join('\n');
});
await safe('balances', () => client.call('get-balances', {}));

const slugs = new Set();
for (const query of ['Airtel', 'Jio', 'Vi Vodafone Idea', 'Amazon', 'Flipkart', 'Swiggy']) {
  await safe(`search ${query}`, async () => {
    const text = await client.call('search-products', { query, intent: 'gift for someone in India', country: 'IN' });
    for (const m of text.matchAll(/\b[a-z0-9_]+(?:-[a-z0-9_]+)*-india\b/g)) slugs.add(m[0]);
    return text.slice(0, 1200);
  });
}
for (const id of [...slugs].slice(0, 8)) {
  await safe(`details ${id}`, async () => (await client.call('get-product-details', { product_id: id, currency: 'INR' })).slice(0, 1800));
}
