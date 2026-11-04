import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPackages, findProducts } from '../src/finder.mjs';

const airtel = readFileSync(new URL('./fixtures/details-airtel.txt', import.meta.url), 'utf8');
const jio = readFileSync(new URL('./fixtures/details-jio.txt', import.meta.url), 'utf8');
const client = (map) => ({ call: async (name, args) => {
  assert.equal(name, 'get-product-details');
  const r = map[args.product_id];
  if (r instanceof Error) throw r;
  return r;
} });

const brands = [
  { slug: 'airtel-india', name: 'Airtel', kind: 'recharge', needsPhone: true },
  { slug: 'reliance-jio-india-bundles', name: 'Jio', kind: 'recharge', needsPhone: true },
];

test('reads_real_packages', () => {
  const p = readPackages(airtel);
  assert.deepEqual(p.find((x) => x.value === '10'), { value: '10', rupees: 10.65 });
  assert.equal(p.length, 5);
});

test('keeps_the_en_dash_in_package_names', () => {
  assert.ok(readPackages(jio).some((x) => x.value === '2GB – 2 Day Data Pack' && x.rupees === 29.82));
});

test('quoted_names_with_commas_survive', () => {
  const text = 'packages[1]{package_value,package_currency,payment_price,payment_currency}:\n  "1GB, 7 Days",INR,"99.50",INR\nurl: x';
  assert.deepEqual(readPackages(text), [{ value: '1GB, 7 Days', rupees: 99.5 }]);
});

test('finds_what_fits_under_the_cap_cheapest_first', async () => {
  const found = await findProducts({ client: client({ 'airtel-india': airtel, 'reliance-jio-india-bundles': jio }), brands, maxRupees: 101, perBrand: 3, log: () => {} });
  assert.ok(found.every((p) => p.rupees <= 101));
  const a = found.filter((p) => p.name === 'Airtel');
  assert.deepEqual(a.map((p) => p.packageValue), ['10']);
  assert.equal(a[0].label, '₹10 recharge');
  assert.equal(a[0].slug, 'airtel-india');
  const j = found.filter((p) => p.name === 'Jio');
  assert.ok(j.length <= 3);
  assert.deepEqual(j.map((p) => p.rupees), [...j.map((p) => p.rupees)].sort((x, y) => x - y));
  assert.equal(new Set(found.map((p) => p.id)).size, found.length);
});

test('number_packages_on_a_card_read_as_gift_cards', async () => {
  const text = 'in_stock: true\npackages[1]{package_value,package_currency,payment_price,payment_currency}:\n  "50",INR,"54.32",INR\nurl: x';
  const [p] = await findProducts({ client: client({ fresh: text }), brands: [{ slug: 'fresh', name: 'Fresh', kind: 'card', needsPhone: false }], maxRupees: 101, perBrand: 3, log: () => {} });
  assert.equal(p.label, '₹50 gift card');
});

test('out_of_stock_brand_is_skipped', async () => {
  const text = airtel.replace('in_stock: true', 'in_stock: false');
  assert.deepEqual(await findProducts({ client: client({ 'airtel-india': text }), brands: brands.slice(0, 1), maxRupees: 101, perBrand: 3, log: () => {} }), []);
});

test('a_failing_brand_does_not_stop_the_others', async () => {
  const found = await findProducts({ client: client({ 'airtel-india': new Error('Bitrefill: no such product'), 'reliance-jio-india-bundles': jio }), brands, maxRupees: 101, perBrand: 3, log: () => {} });
  assert.ok(found.length > 0);
  assert.ok(found.every((p) => p.name === 'Jio'));
});
