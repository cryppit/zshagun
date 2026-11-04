// Gift states and daily spend. Every claim is written here before anything is bought.
import { DatabaseSync } from 'node:sqlite';

const FIELDS = ['height', 'code', 'invoice_id', 'refund_txid', 'note', 'phone', 'opened_txid', 'delivered_at'];
const IST_MS = 5.5 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

export function createLedger(path) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS gifts (
    id TEXT PRIMARY KEY, txid TEXT NOT NULL, output INTEGER NOT NULL, zat INTEGER NOT NULL, tier INTEGER NOT NULL,
    refund_to TEXT, blob TEXT NOT NULL, height INTEGER, state TEXT NOT NULL, created_at INTEGER NOT NULL,
    claimed_at INTEGER, product_id TEXT, rupees INTEGER, phone TEXT, code TEXT, invoice_id TEXT,
    refund_txid TEXT, opened_txid TEXT, delivered_at INTEGER, note TEXT,
    UNIQUE (txid, output))`);
  const get = db.prepare('SELECT * FROM gifts WHERE id = ?');
  const insert = db.prepare(`INSERT OR IGNORE INTO gifts (id, txid, output, zat, tier, refund_to, blob, height, state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'seen', ?)`);
  const claim = db.prepare(`UPDATE gifts SET state = 'claimed', product_id = ?, phone = ?, rupees = ?, claimed_at = ?
    WHERE id = ? AND state = 'confirmed'`);
  const spent = db.prepare(`SELECT COALESCE(SUM(rupees), 0) AS total FROM gifts
    WHERE claimed_at >= ? AND claimed_at < ? AND COALESCE(invoice_id, '') NOT LIKE 'dry-%'`);
  return {
    addGift: ({ id, txid, output, zat, tier, refundTo, blob, height, now }) =>
      insert.run(id, txid, output, zat, tier, refundTo, blob, height, now).changes === 1,
    get: (id) => get.get(id),
    all: () => db.prepare('SELECT * FROM gifts').all(),
    inState: (...states) => db.prepare(`SELECT * FROM gifts WHERE state IN (${states.map(() => '?').join(',')})`).all(...states),
    setState(id, state, fields = {}) {
      const names = Object.keys(fields);
      for (const n of names) if (!FIELDS.includes(n)) throw new Error(`unknown field ${n}`);
      const sets = ['state = ?', ...names.map((n) => `${n} = ?`)].join(', ');
      db.prepare(`UPDATE gifts SET ${sets} WHERE id = ?`).run(state, ...names.map((n) => fields[n]), id);
    },
    claimOnce: (id, { productId, phone, rupees, now }) => claim.run(productId, phone ?? null, rupees, now, id).changes === 1,
    spentToday(now) {
      const start = Math.floor((now + IST_MS) / DAY_MS) * DAY_MS - IST_MS;
      return spent.get(start, start + DAY_MS).total;
    },
    forget: (id) => db.prepare('UPDATE gifts SET phone = NULL, code = NULL WHERE id = ?').run(id),
    close: () => db.close(),
  };
}
