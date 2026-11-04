import test from 'node:test';
import assert from 'node:assert/strict';
import { startDemo } from '../src/demo.mjs';
import { claimToken, decryptMessage, giftId } from '../web/gift.js';

test('demo_runs_the_whole_flow_with_nothing_installed', async (t) => {
  const demo = await startDemo({ apiPort: 0, webPort: 0, log: () => {} });
  t.after(demo.stop);
  const secret = new URL(demo.link).hash.slice(1);
  const id = await giftId(secret);

  const gift = await (await fetch(`${demo.api}/gift/${id}`)).json();
  assert.equal(gift.state, 'open');
  assert.match(await decryptMessage(secret, gift.blob), /Diwali/);

  const card = gift.choices.find((c) => c.kind === 'card');
  const token = await claimToken(secret);
  const r = await fetch(`${demo.api}/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, token, productId: card.id }) });
  assert.equal(r.status, 202);
  await demo.settled();
  const done = await (await fetch(`${demo.api}/claim/${id}`, { headers: { 'x-shagun-token': token } })).json();
  assert.equal(done.state, 'delivered');
  assert.match(done.code, /DRY-RUN/);
});

test('demo_serves_the_page_pointed_at_itself', async (t) => {
  const demo = await startDemo({ apiPort: 0, webPort: 0, log: () => {} });
  t.after(demo.stop);
  const web = new URL(demo.link).origin;
  assert.equal((await fetch(`${web}/`)).status, 200);
  assert.match(await (await fetch(`${web}/config.js`)).text(), new RegExp(demo.api));
  assert.equal((await fetch(`${web}/../package.json`)).status, 404);
});
