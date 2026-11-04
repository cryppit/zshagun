// Read-only: shows what the agent can buy today under the gift cap. It cannot buy anything.
// node --env-file=../shagun.env scripts/find-products.mjs
import { readFileSync } from 'node:fs';
import { createMcpClient } from '../src/bitrefill.mjs';
import { findProducts } from '../src/finder.mjs';

const { brands } = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url)));
const client = createMcpClient({ url: 'https://api.bitrefill.com/mcp', token: process.env.BITREFILL_API_KEY });
const found = await findProducts({ client, brands, maxRupees: 101, perBrand: 3, log: console.log });
for (const p of found) console.log(`${String(p.rupees).padStart(7)}  ${p.name}  ${p.label}`);
