import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TIERS } from '../web/gift.js';

const { products } = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url)));

test('every_tier_can_buy_something', () => {
  for (const tier of TIERS) assert.ok(products.some((p) => p.rupees <= tier), String(tier));
});

test('nothing_costs_more_than_the_gift_cap', () => {
  for (const p of products) assert.ok(p.rupees <= 101, p.id);
});

test('every_product_is_complete', () => {
  for (const p of products) {
    for (const k of ['id', 'name', 'label', 'kind', 'packageValue']) assert.equal(typeof p[k], 'string', `${p.id} ${k}`);
    assert.equal(typeof p.needsPhone, 'boolean');
  }
});

test('a_gift_card_is_offered_for_a_real_code', () => {
  assert.ok(products.some((p) => p.kind === 'card'));
});

test('slugs_are_the_real_bitrefill_slugs', () => {
  const known = ['airtel-india', 'vi-india', 'reliance-jio-india-bundles', 'amazon-fresh-india'];
  for (const p of products) assert.ok(known.includes(p.slug), p.slug);
});
