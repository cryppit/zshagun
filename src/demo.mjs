// `npm run demo`: the whole gift flow on your machine in a minute, with no wallet, no key and no purchase.
// The wallet and Bitrefill are stand-ins. Everything else is the real code.
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { makeGift } from '../web/flow.js';
import { newAgentKey } from '../web/gift.js';
import { createDryBitrefill } from './bitrefill.mjs';
import { createLedger } from './ledger.mjs';
import { createApp } from './server.mjs';
import { watch } from './watcher.mjs';

const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const listen = (server, port) => new Promise((r) => { server.listen(port, '127.0.0.1', () => r(server.address().port)); });

export async function startDemo({ apiPort = 8791, webPort = 8080, log = console.log } = {}) {
  let api;
  const web = http.createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    try {
      if (path === '/config.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        return res.end(`export const config = { api: '${api}', agentAddress: 'demo' };`);
      }
      const file = join(webRoot, path === '/' ? 'index.html' : path);
      if (!file.startsWith(webRoot)) throw new Error('outside');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      return res.end(body);
    } catch {
      res.writeHead(404);
      return res.end();
    }
  });
  const webPortUsed = await listen(web, webPort);
  const pageUrl = `http://localhost:${webPortUsed}/`;

  const { products } = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url)));
  const ledger = createLedger(':memory:');
  const gift = await makeGift({ tier: 101, message: 'Happy Diwali! This is a demo gift.', refundTo: null, agentAddress: 'demo', pageUrl });
  const wallet = {
    refresh: async () => {},
    tip: async () => 100,
    incoming: async () => [{ txid: 'd'.repeat(64), output: 0, zat: gift.zat, memo: gift.memo, height: 100 }],
    send: async () => 'd'.repeat(64),
  };
  const app = createApp({
    ledger, wallet, catalog: products, log, now: Date.now, bitrefill: createDryBitrefill({ log }),
    limits: { perGift: 101, perDay: 300, floor: 0 }, agentKey: await newAgentKey(),
    origins: [`http://localhost:${webPortUsed}`],
  });
  api = `http://localhost:${await listen(app.server, apiPort)}`;
  await watch({ wallet, ledger, log, now: Date.now, limits: { perGift: 101, perDay: 300, floor: 0 }, confirmations: 1, expireMs: 86400000 });
  return {
    link: gift.link, api, settled: app.settled,
    stop: () => { web.close(); app.server.close(); ledger.close(); },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { link } = await startDemo({ log: () => {} });
  console.log(`\nOpen this gift (it buys nothing, and the code it shows is not real):\n\n  ${link}\n\nStop with Ctrl-C.`);
}
