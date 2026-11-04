// Every screen, as a string of HTML. Anything a person typed goes through esc().
import { TIERS } from './gift.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DIYA = `<svg class="diya" viewBox="0 0 120 120" aria-hidden="true">
  <path class="flame" d="M60 14c9 14 15 22 15 32a15 15 0 0 1-30 0c0-10 6-18 15-32z"/>
  <path class="flame-in" d="M60 32c4 7 7 11 7 16a7 7 0 0 1-14 0c0-5 3-9 7-16z"/>
  <path class="lamp" d="M14 66h92c0 22-20 38-46 38S14 88 14 66z"/>
  <path class="lamp-rim" d="M14 66h92l-5 8H19z"/>
</svg>`;

const card = (body, cls = '') => `<section class="card ${cls}">${body}</section>`;
const notice = (title, text, extra = '') => card(`${DIYA}<h1>${title}</h1><p>${text}</p>${extra}`, 'center');

const rupees = (n) => `₹${esc(n)}`;
const taz = (zat) => (zat / 1e8).toFixed(2);

const VIEWS = {
  give: ({ tier = 51, error }) => card(`
    <p class="brand">शगुन · Shagun</p>
    <h1>Send a private gift</h1>
    <p class="muted">They tap a link and pick something they want. They don't need any app.</p>
    <form id="give">
      <fieldset class="tiers"><legend>How much?</legend>
        ${TIERS.map((t) => `<label><input type="radio" name="tier" value="${t}" ${t === tier ? 'checked' : ''}><span>₹${t}</span></label>`).join('')}
      </fieldset>
      <label class="field">Your message
        <textarea name="message" rows="3" maxlength="120" placeholder="Happy Diwali! Get something nice."></textarea>
      </label>
      <details><summary>If they never open it</summary>
        <label class="field">Refund address (optional)
          <input name="refund" autocomplete="off" spellcheck="false" placeholder="utest1…">
        </label>
        <p class="muted small">With this, an unopened gift comes back after 24 hours and you get a private note when it's opened. Without it, an unopened gift can't come back.</p>
      </details>
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
      <button class="primary" type="submit">Make my gift</button>
    </form>
    <p class="muted small">Your message is locked in this browser. Nothing is sent until you pay.</p>`),

  pay: ({ zat, uri, qr }) => card(`
    <h1>Pay to lock it in</h1>
    <p class="muted">Scan with an NU7 testnet wallet, or copy the payment link. The note on the payment is already filled in.</p>
    <div class="qr">${qr}</div>
    <p class="amount">${taz(zat)} TAZ <span class="muted small">demo rate: 1 TAZ = ₹1,000</span></p>
    <button class="ghost" data-copy="${esc(uri)}">Copy payment link</button>
    <button class="primary" data-go="share">I've paid</button>
    <p class="muted small">Stay on this page. Your gift link comes next, and only this page has it.</p>`),

  share: ({ link }) => card(`
    ${DIYA}<h1>Your gift is ready</h1>
    <p>Send this link to one person. Treat it like cash: anyone who has it can open the gift.</p>
    <p class="link">${esc(link)}</p>
    <button class="primary" data-share="${esc(link)}">Share</button>
    <button class="ghost" data-copy="${esc(link)}">Copy link</button>
    <p class="muted small">It can open a couple of minutes after your payment goes through.</p>`, 'center'),

  on_its_way: () => notice('Your gift is on its way', 'It will open here by itself, usually within a few minutes. You can keep this page open.', '<p class="pulse" aria-hidden="true">· · ·</p>'),

  open: ({ tier, message }) => card(`
    ${DIYA}<h1>Someone sent you a Shagun</h1>
    ${message ? `<blockquote>${esc(message)}</blockquote>` : ''}
    <p class="amount">${rupees(tier)}</p>
    <button class="primary" data-go="choosing">Open my gift</button>`, 'center'),

  choosing: ({ tier, choices = [], error }) => card(`
    <h1>What would you like?</h1>
    <p class="muted">Your gift is ${rupees(tier)}.</p>
    <form id="choose">
      <div class="choices">
        ${choices.map((c, i) => `<label class="choice"><input type="radio" name="product" value="${esc(c.id)}" data-phone="${c.needsPhone ? 1 : 0}" ${i === 0 ? 'checked' : ''}>
          <span><b>${esc(c.name)}</b><small>${esc(c.label)}</small></span></label>`).join('')}
      </div>
      <label class="field" id="phone-field">Phone number to recharge
        <input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="98765 43210">
      </label>
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
      <button class="primary" type="submit">Get it</button>
    </form>
    <p class="muted small">You can only choose once.</p>`),

  buying: () => notice('Getting it for you', 'This usually takes a few seconds. Please keep this page open.', '<p class="pulse" aria-hidden="true">· · ·</p>'),

  done_recharge: ({ product }) => notice('Done!', `Your ${esc(product?.name)} ${esc(product?.label)} is on its way to your phone. Your carrier will send you a message.`),

  done_code: ({ product, code, pin, link }) => card(`
    ${DIYA}<h1>Here's your gift</h1>
    <p>${esc(product?.name)} · ${esc(product?.label)}</p>
    ${code ? `<p class="code">${esc(code)}</p><button class="ghost" data-copy="${esc(code)}">Copy code</button>` : ''}
    ${pin ? `<p>PIN: <b>${esc(pin)}</b></p>` : ''}
    ${link ? `<p><a href="${esc(link)}" target="_blank" rel="noreferrer noopener">Open your gift</a></p>` : ''}
    <p class="muted small">Save this now. We delete it after you tap below, and it can't be shown again.</p>
    <button class="primary" data-seen="1">I've saved it</button>`, 'center'),

  already_opened: () => notice('This gift has been opened', 'One link, one gift. If that wasn\'t you, ask the person who sent it.'),
  expired: () => notice('This gift has expired', 'It wasn\'t opened in time. If the sender left a refund address, it has gone back to them.'),
  refused: () => notice('This gift couldn\'t be accepted', 'Today\'s gift budget may be used up, or the payment was too small. If the sender left a refund address, it has gone back to them.'),
  limit_reached: () => notice('We\'ve run out for today', 'Your gift is safe and still yours. Please come back tomorrow.'),
  needs_human: () => notice('Something went wrong on our side', 'Your gift isn\'t lost. A person needs to look at it, so please ask whoever sent it to contact Shagun.'),
  service_down: () => notice('Shagun isn\'t answering right now', 'Your gift is safe. Please try again in a minute.', '<button class="primary" data-reload="1">Try again</button>'),
  bad_link: () => notice('This link looks incomplete', 'Part of it may have been cut off. Ask the sender to send it again, and open the whole link.'),
};

export function screen(state) {
  return (VIEWS[state.screen] ?? VIEWS.bad_link)(state);
}
