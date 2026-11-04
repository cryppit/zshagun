// Every screen, as a string of HTML. Anything a person typed goes through esc().
import { TIERS } from './gift.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const rupees = (n) => `₹${esc(n)}`;
const taz = (zat) => (zat / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');

// The gold coin that seals a lifafa. A shagun always carries the extra one.
export const coin = (label = 'z', cls = '') => `<svg class="coin ${cls}" viewBox="0 0 200 200" aria-hidden="true">
  <defs>
    <radialGradient id="face" cx=".36" cy=".3" r=".85"><stop offset="0" stop-color="#fff3bf"/><stop offset=".42" stop-color="#f7c948"/><stop offset="1" stop-color="#b8770f"/></radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe9a3"/><stop offset=".5" stop-color="#c98a14"/><stop offset="1" stop-color="#8a5508"/></linearGradient>
  </defs>
  <circle cx="100" cy="100" r="98" fill="url(#rim)"/>
  <circle cx="100" cy="100" r="86" fill="url(#face)"/>
  <circle cx="100" cy="100" r="78" fill="none" stroke="#9a6409" stroke-width="3" stroke-dasharray="1.5 7" stroke-linecap="round"/>
  <text x="100" y="${label.length > 1 ? 121 : 134}" text-anchor="middle" class="coin-text ${label.length > 1 ? 'small' : ''}">${esc(label)}</text>
</svg>`;

const mark = '<p class="mark"><span>z</span>shagun</p>';

// The real Zcash brandmark, unaltered, as a credit only. Their policy allows "powered by Zcash" with a link to z.cash,
// as long as our own name stays more prominent. It must never be used as our logo.
const powered = `<a class="powered" href="https://z.cash" target="_blank" rel="noreferrer noopener">
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0A12 12 0 0 0 0 12a12.013 12.013 0 0 0 12 12 12 12 0 1 0 0-24zm-1.008 4.418h2.014v2.014l3.275-.002v1.826l-5.08 6.889h5.08v2.423h-3.275v2.006h-2.012v-2.006H7.72v-1.826l5.074-6.888H7.719V6.432h3.273V4.418z"/></svg>
  <span>Powered by Zcash</span></a>`;

const lifafa = (inner = '') => `<div class="lifafa">
  <svg class="flap" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="0,0 100,0 50,100" class="flap-fill"/>
    <polyline points="0,0 50,100 100,0" class="flap-line"/>
  </svg>
  <svg class="folds" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="0,100 50,62 100,100" class="fold-line"/></svg>
  ${inner}
</div>`;

const paper = (body, cls = '') => `${mark}<section class="paper ${cls}">${body}</section>`;
const notice = (title, text, extra = '', c = 'z') => paper(`${coin(c, 'small-coin')}<h1>${title}</h1><p>${text}</p>${extra}`, 'center');

const tile = (c, picked) => `<label class="tile"><input type="radio" name="product" value="${esc(c.id)}" data-phone="${c.needsPhone ? 1 : 0}" ${c.id === picked ? 'checked' : ''}>
  <span class="tile-in"><i class="brand b-${esc(String(c.name).toLowerCase().replace(/[^a-z]/g, ''))}" aria-hidden="true">${esc(String(c.name).slice(0, 1))}</i>
  <b>${esc(c.name)}</b><small>${esc(c.label)}</small></span></label>`;

const group = (title, list, picked) => (list.length ? `<h2>${title}</h2><div class="tiles">${list.map((c) => tile(c, picked)).join('')}</div>` : '');

const VIEWS = {
  give: ({ tier = 51, error }) => paper(`
    <p class="kicker">शगुन, sealed</p>
    <h1>A gift only they can open</h1>
    <p class="lede">They tap a link and choose what they want. They don't need an app, and nobody else can see it.</p>
    <form id="give">
      <fieldset class="tiers"><legend>Pick the coin</legend>
        ${TIERS.map((t) => `<label><input type="radio" name="tier" value="${t}" ${t === tier ? 'checked' : ''}><span class="tier">${coin(`₹${t}`)}</span></label>`).join('')}
      </fieldset>
      <label class="field">Write your note
        <textarea name="message" rows="3" maxlength="120" placeholder="Happy Diwali! Get something nice."></textarea>
      </label>
      <details><summary>If they never open it</summary>
        <label class="field">Refund address (optional)
          <input name="refund" autocomplete="off" spellcheck="false" placeholder="utest1…">
        </label>
        <p class="fine">With this, an unopened gift comes back after 24 hours, and you get a private note when it's opened. Without it, an unopened gift can't come back.</p>
      </details>
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
      <button class="gold" type="submit">Seal it</button>
    </form>
    <p class="fine">Your note is locked in this browser. Nothing is sent until you pay.</p>
    ${powered}`),

  pay: ({ zat, uri, qr }) => paper(`
    <p class="kicker">One step left</p>
    <h1>Pay to seal it</h1>
    <p class="lede">Scan with an NU7 testnet wallet, or copy the payment link. The note on the payment is already filled in.</p>
    <div class="qr">${qr}</div>
    <p class="amount">${taz(zat)} TAZ<small>demo rate: 1 TAZ = ₹1,000</small></p>
    <button class="ghost" data-copy="${esc(uri)}">Copy payment link</button>
    <button class="gold" data-go="share">I've paid</button>
    <p class="fine"><b>Who can see this:</b> the public chain shows a private payment, not who, how much or the message. zshagun sees the amount and your refund address if you gave one, but not your name or message. Your wallet adds a small network fee.</p>
    <p class="fine">Stay on this page. Your gift link comes next, and only this page has it.</p>
    ${powered}`),

  share: ({ link }) => paper(`
    ${coin('z', 'drop')}
    <h1>Sealed</h1>
    <p>Send this link to one person. Treat it like cash: anyone who has it can open the gift.</p>
    <p class="link">${esc(link)}</p>
    <button class="gold" data-share="${esc(link)}">Send it</button>
    <button class="ghost" data-copy="${esc(link)}">Copy link</button>
    <p class="fine">It can open a minute or two after your payment goes through.</p>
    ${powered}`, 'center'),

  on_its_way: () => `<div class="scene">${mark}${coin('z', 'spin')}<h1 class="on-red">Your gift is on its way</h1><p class="on-red">It will open here by itself, usually within a couple of minutes. You can keep this page open.</p></div>`,

  open: ({ tier, message }) => `<div class="stage">
    ${mark}
    ${lifafa(`<button class="seal" data-open="1" aria-label="Open your gift">${coin('z')}</button>
      <div class="invite"><h1>A shagun for you</h1><p>Tap the coin to open</p></div>`)}
    <section class="letter" aria-label="Your gift">
      <p class="kicker">Someone is thinking of you</p>
      ${message ? `<blockquote>${esc(message)}</blockquote>` : ''}
      <p class="sum">${rupees(tier)}</p>
      <button class="gold" data-go="choosing">Choose your gift</button>
    </section>
  </div>`,

  choosing: ({ tier, choices = [], error, picked, phoneText }) => {
    const recharges = choices.filter((c) => c.kind === 'recharge');
    const cards = choices.filter((c) => c.kind !== 'recharge');
    const chosen = choices.some((c) => c.id === picked) ? picked : [...recharges, ...cards][0]?.id;
    return paper(`
    <p class="kicker">Your gift is ${rupees(tier)}</p>
    <h1>What would you like?</h1>
    <form id="choose">
      ${group('Phone', recharges, chosen)}
      ${group('Gift cards', cards, chosen)}
      <label class="field" id="phone-field">Phone number to recharge
        <input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="98765 43210" value="${esc(phoneText)}">
        <span class="fine hint">zshagun and Bitrefill see this number, to do the recharge. zshagun deletes it afterwards.</span>
      </label>
      <div class="dock">${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}<button class="gold" type="submit">Get it</button><p class="fine">You can only choose once.</p></div>
    </form>`);
  },

  buying: () => `<div class="scene">${mark}${coin('z', 'spin')}<h1 class="on-red">Getting it for you</h1><p class="on-red">This usually takes a few seconds. Please keep this page open.</p></div>`,

  done_recharge: ({ product }) => `${mark}<section class="ticket">
    <p class="stamp">Done</p>
    <h1>${esc(product?.name)}</h1>
    <p class="sum-small">${esc(product?.label)}</p>
    <p>On its way to your phone. Your carrier will send you a message.</p>
  </section>`,

  done_code: ({ product, code, pin, link }) => `${mark}<section class="ticket">
    <p class="stamp">Yours</p>
    <h1>${esc(product?.name)}</h1>
    <p class="sum-small">${esc(product?.label)}</p>
    ${code ? `<p class="code">${esc(code)}</p><button class="ghost" data-copy="${esc(code)}">Copy code</button>` : ''}
    ${pin ? `<p>PIN: <b>${esc(pin)}</b></p>` : ''}
    ${link ? `<p><a href="${esc(link)}" target="_blank" rel="noreferrer noopener">Open your gift</a></p>` : ''}
    <p class="fine">Save this now. We delete it after you tap below, and it can't be shown again.</p>
    <button class="gold" data-seen="1">I've saved it</button>
  </section>`,

  already_opened: () => notice('This gift has been opened', 'One link, one gift. If that wasn\'t you, ask the person who sent it.'),
  expired: () => notice('This gift has expired', 'It wasn\'t opened in time. If the sender left a refund address, it has gone back to them.'),
  refused: () => notice('This gift couldn\'t be accepted', 'Today\'s gift budget may be used up, or the payment was too small. If the sender left a refund address, it has gone back to them.'),
  limit_reached: () => notice('We\'ve run out for today', 'Your gift is safe and still yours. Please come back tomorrow.'),
  needs_human: () => notice('Something went wrong on our side', 'Your gift isn\'t lost. A person needs to look at it, so please ask whoever sent it to contact zshagun.'),
  service_down: () => notice('zshagun isn\'t answering right now', 'Your gift is safe. Please try again in a minute.', '<button class="gold" data-reload="1">Try again</button>'),
  bad_link: () => notice('This link looks incomplete', 'Part of it may have been cut off. Ask the sender to send it again, and open the whole link.'),
};

export function screen(state) {
  return (VIEWS[state.screen] ?? VIEWS.bad_link)(state);
}
