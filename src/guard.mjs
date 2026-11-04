// Every spending rule, in one place. Pure: same inputs, same answer.
import { tierZat } from '../web/gift.js';

const no = (reason) => ({ ok: false, reason });

export function checkGift({ tier, zat, spentToday, limits }) {
  if (tier > limits.perGift) return no('over_gift_cap');
  if (zat < tierZat(tier)) return no('underpaid');
  if (spentToday + tier > limits.perDay) return no('over_day_cap');
  return { ok: true };
}

export function checkClaim({ tier, productId, catalog, spentToday, balance, limits }) {
  const product = catalog.find((p) => p.id === productId);
  if (!product) return no('product_not_listed');
  if (product.rupees > tier) return no('costs_more_than_gift');
  if (product.rupees > limits.perGift) return no('over_gift_cap');
  if (spentToday + product.rupees > limits.perDay) return no('over_day_cap');
  if (balance - product.rupees < limits.floor) return no('below_float_floor');
  return { ok: true, product };
}
