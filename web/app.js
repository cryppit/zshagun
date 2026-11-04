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
  syncPhoneField();
  if (state.screen === 'on_its_way') timer = setTimeout(refresh, 10000);
  if (state.screen === 'buying') timer = setTimeout(poll, 2000);
  if (state.screen === 'done_code' || state.screen === 'done_recharge') shower();
  window.scrollTo(0, 0);
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

const PETALS = ['#f08a12', '#f7c948', '#e8590c', '#fff3bf', '#d9232f'];

function shower() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < 34; i++) {
    const p = document.createElement('i');
    const set = (k, v) => p.style.setProperty(k, v);
    p.className = 'petal';
    set('--x', `${Math.random() * 100}vw`);
    set('--s', `${9 + Math.random() * 10}px`);
    set('--c', PETALS[i % PETALS.length]);
    set('--d', `${2.4 + Math.random() * 2.2}s`);
    set('--w', `${0.5 + Math.random() * 1.1}s`);
    set('--dx', `${(Math.random() - 0.5) * 160}px`);
    set('--r', `${(Math.random() - 0.5) * 900}deg`);
    p.addEventListener('animationend', () => p.remove());
    document.body.append(p);
  }
}

root.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.open) {
    navigator.vibrate?.(25);
    root.querySelector('.stage').classList.add('is-open');
    shower();
  }
  if (b.dataset.copy) copy(b, b.dataset.copy);
  if (b.dataset.go) show({ screen: b.dataset.go, error: null });
  if (b.dataset.reload) refresh();
  if (b.dataset.share) {
    if (navigator.share) navigator.share({ title: 'A shagun for you', text: 'A shagun for you. Tap to open your gift:', url: b.dataset.share }).catch(() => {});
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
    // A retry must never quietly change what was chosen: this decides what gets bought.
    state = { ...state, picked: picked.value, phoneText: form.get('phone') ?? '' };
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
