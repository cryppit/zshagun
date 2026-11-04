// Wires the screens to the page. The logic is in flow.js, the markup in views.js.
import { config } from './config.js';
import { loadGift, makeGift, markSeen, indianPhone, pollClaim, submitClaim } from './flow.js';
import { screen } from './views.js';

const root = document.getElementById('app');
const api = { base: config.api, fetch: (...a) => fetch(...a) };
let state = {};
let timer = null;

function show(next) {
  state = { ...state, ...next };
  clearTimeout(timer);
  root.innerHTML = screen(state);
  root.querySelector('h1')?.focus?.();
  syncPhoneField();
  if (state.screen === 'on_its_way') timer = setTimeout(refresh, 10000);
  if (state.screen === 'buying') timer = setTimeout(poll, 2000);
}

async function refresh() {
  show(await loadGift(location.hash, api));
}

async function poll() {
  show(await pollClaim(state.secret, api));
}

function syncPhoneField() {
  const field = root.querySelector('#phone-field');
  if (!field) return;
  const picked = root.querySelector('input[name=product]:checked');
  field.hidden = picked?.dataset.phone !== '1';
}

function qrSvg(text) {
  const qr = window.qrcode(0, 'L');
  qr.addData(text, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: 3, margin: 8, scalable: true, alt: 'Payment QR code' });
}

async function copy(button, text) {
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Press and hold the text to copy';
  }
  setTimeout(() => { button.textContent = label; }, 1800);
}

root.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.copy) copy(b, b.dataset.copy);
  if (b.dataset.go) show({ screen: b.dataset.go, error: null });
  if (b.dataset.reload) refresh();
  if (b.dataset.share) {
    if (navigator.share) navigator.share({ title: 'A Shagun for you', url: b.dataset.share }).catch(() => {});
    else copy(b, b.dataset.share);
  }
  if (b.dataset.seen) {
    await markSeen(state.secret, api);
    show({ screen: 'already_opened', code: null, pin: null, link: null });
  }
});

root.addEventListener('change', syncPhoneField);

root.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const button = e.target.querySelector('button[type=submit]');

  if (e.target.id === 'give') {
    try {
      const gift = await makeGift({
        tier: Number(form.get('tier')), message: form.get('message').trim(), refundTo: form.get('refund')?.trim() || null,
        agentAddress: config.agentAddress, pageUrl: location.origin + location.pathname,
      });
      show({ screen: 'pay', ...gift, qr: qrSvg(gift.uri), error: null });
    } catch (err) {
      show({ screen: 'give', error: err.message.includes('memo') ? 'That message is too long. Shorten it a little.' : err.message });
    }
  }

  if (e.target.id === 'choose') {
    const picked = e.target.querySelector('input[name=product]:checked');
    if (!picked) return;
    let phone = null;
    if (picked.dataset.phone === '1') {
      phone = indianPhone(form.get('phone') ?? '');
      if (!phone) return show({ error: 'Enter a 10-digit Indian mobile number.' });
    }
    button.disabled = true;
    show(await submitClaim({ secret: state.secret, productId: picked.value, phone, key: state.key }, api));
  }
});

window.addEventListener('hashchange', () => location.reload());

if (location.hash.length > 1) {
  show({ screen: 'buying' });
  refresh();
} else {
  show({ screen: 'give' });
}
