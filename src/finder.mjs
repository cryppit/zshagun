// The agent's shopping step: ask Bitrefill what each allowed brand sells today, and keep what fits under the cap.
// Bitrefill's purchase call carries no price, so prices always come from here, never from memory.

export function readPackages(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^packages\[\d+\]\{/.test(l));
  if (start < 0) return [];
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith(' ')) break;
    const m = line.match(/^\s+(.+),[A-Z]{3},"?([\d.]+)"?,[A-Z]{3}\s*$/);
    if (m) rows.push({ value: m[1].replace(/^"(.*)"$/, '$1'), rupees: Number(m[2]) });
  }
  return rows;
}

export const inStock = (text) => !/^in_stock: false/m.test(text);

function label(value, kind) {
  if (!/^\d+$/.test(value)) return value;
  return `₹${value} ${kind === 'card' ? 'gift card' : 'recharge'}`;
}

export async function findProducts({ client, brands, maxRupees, perBrand, log }) {
  const found = [];
  for (const brand of brands) {
    try {
      const text = await client.call('get-product-details', { product_id: brand.slug, currency: 'INR' });
      if (!inStock(text)) continue;
      const fits = readPackages(text).filter((p) => p.rupees <= maxRupees).sort((a, b) => a.rupees - b.rupees).slice(0, perBrand);
      for (const p of fits) {
        found.push({
          id: `${brand.slug}~${p.value}`, slug: brand.slug, name: brand.name, label: label(p.value, brand.kind), kind: brand.kind,
          rupees: p.rupees, packageValue: p.value, needsPhone: brand.needsPhone,
        });
      }
    } catch (e) {
      log(`finder skipped ${brand.slug}: ${e.code ?? 'error'}`);
    }
  }
  return found;
}
