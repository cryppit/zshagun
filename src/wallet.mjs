// Drives zcash-devtool. The wallet is one SQLite file, so commands run one at a time.
import { execFile } from 'node:child_process';

const toZat = (taz) => {
  const [whole, frac = ''] = taz.split('.');
  return Number(whole) * 1e8 + Number(frac.padEnd(8, '0'));
};

const unescapeMemo = (s) => s.replace(/\\(["\\'])/g, '$1');

// `list-tx` text output. The CSV mode has no txid and breaks on commas, so this reads the text mode.
export function parseIncoming(text) {
  const rows = [];
  let txid = null, height = null, out = null;
  const flush = () => {
    if (out?.received && !out.change) rows.push({ txid, output: out.output, zat: out.zat, memo: out.memo, height });
    out = null;
  };
  for (const line of text.split('\n')) {
    let m;
    if (/^[0-9a-f]{64}$/.test(line)) { flush(); txid = line; height = null; }
    else if ((m = line.match(/^\s+Mined: (\d+)/))) height = Number(m[1]);
    else if ((m = line.match(/^\s+Output (\d+) \(/))) { flush(); out = { output: Number(m[1]), zat: 0, memo: '', received: false, change: false }; }
    else if (out && (m = line.match(/^\s+Value:\s+([\d.]+) TAZ( \(Change\))?/))) { out.zat = toZat(m[1]); out.change = Boolean(m[2]); }
    else if (out && /^\s+Received by account:/.test(line)) out.received = true;
    else if (out && (m = line.match(/^\s+Memo: Memo::Text\("(.*)"\)$/))) out.memo = unescapeMemo(m[1]);
  }
  flush();
  return rows;
}

export function realExec(binary) {
  return (args) => new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: 180000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr).trim().split('\n').pop() || err.message));
      else resolve(stdout);
    });
  });
}

export function createWallet({ exec, dir, identity }) {
  const base = ['wallet', '-w', dir];
  let queue = Promise.resolve();
  const run = (args) => {
    const result = queue.then(() => exec([...base, ...args]));
    queue = result.catch(() => {});
    return result;
  };
  return {
    async refresh() {
      const sync = run(['sync']);
      const enhance = run(['enhance']);
      await sync;
      await enhance;
    },
    async incoming() {
      return parseIncoming(await run(['list-tx']));
    },
    async tip() {
      return JSON.parse(await run(['get-info'])).chain_tip_height;
    },
    async send({ address, zat, memo }) {
      let out;
      try {
        out = await run(['send', '-i', identity, '--address', address, '--value', String(zat), '--memo', memo]);
      } catch (e) {
        throw new Error(`zcash-devtool could not send: ${e.message}`);
      }
      const txid = out.trim().split('\n').pop();
      if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('zcash-devtool sent no txid');
      return txid;
    },
  };
}
