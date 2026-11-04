# zshagun

**Send a private gift from shielded Zcash as a link.** The person you love taps it, picks a phone recharge or gift card,
and gets it, with no wallet, no app and no account, and no public record linking the two of you.

In India, *shagun* is the gift of money you give at Diwali and weddings. It traditionally ends in 1, so gifts here are ₹11, ₹51 or ₹101.

- **Page:** https://cryppit.github.io/zshagun/
- **Network:** Zcash NU7 testnet, shielded through unified addresses
- **Built at:** Free Society Hack, Mumbai, 4 November 2026. The idea was planned before the event; all code here was written on 4 November.

## The demo in five lines

1. The giver picks ₹51 and writes a message. The browser locks the message and makes a secret link.
2. The giver pays from a shielded wallet. The payment's memo carries a fingerprint of the secret and the locked message.
3. The giver sends the link on WhatsApp.
4. The recipient taps it, reads the message and picks an Airtel recharge. They never see the word "crypto".
5. An agent checks its limits, buys through Bitrefill from a prepaid balance, and sends the giver a private "opened" note.

## How it works

The link's `#fragment` holds a 32-byte secret `S`. Browsers don't send a fragment to any server. Two keys come out of `S`:

| Key | Made by | Used for | Who gets it |
|---|---|---|---|
| Claim token `T` | HKDF(S, "claim") | Proving you hold the link. Gift id = SHA-256(T) | The agent, at claim time |
| Message key | HKDF(S, "message") | AES-GCM on the message | Nobody. It never leaves the browser |

The agent holds only the id and the locked message until someone claims. Even then it gets `T`, which can't unlock the message.
So the agent can't open a gift early, and it can't read the message at all.

The memo is text, under 512 bytes: `SHG1|id|tier|refund address or -|locked message`.

**Gift states:** seen, mined, confirmed, claimed, buying, delivered. Or: refused, expired, refunded, needs a human.

**What stops a double purchase:** one SQL update moves a gift from `confirmed` to `claimed`, and only one caller can win it. That
happens before anything is bought. A purchase is one call and is never retried, because Bitrefill warns that a second try after an unclear
failure can charge twice. If the agent stops after claiming and before it has an invoice, restart marks the gift "needs a human". If it
already has an invoice, restart goes back to polling that invoice.

## Guardrails

The agent spends only inside limits that sit in code and config. There is no approval path around them.

- At most **₹101 per gift** and **₹300 a day**, counted at the real price. A balance floor can be set too.
- Only products in `catalog.json`, and a choice must cost no more than the gift.
- Each gift buys once. A crash ends in "needs a human", never a retry.
- `POST /claim` is rate limited per IP, in memory.
- Live buying is off unless `SHAGUN_LIVE=1`. Without it, the agent runs the whole flow and buys nothing.
- No log holds an IP, phone number, secret or code. Phone numbers stay sealed to the agent's key in the ledger and are wiped after delivery.
  A gift code is wiped when the recipient taps "I've saved it", or after an hour.

## Who sees what

| Hop | Sees | Doesn't see |
|---|---|---|
| Public chain | That a shielded transaction happened | Who, how much, the message |
| Giver's light-wallet server | The giver's IP and sync pattern | The gift |
| Page host (GitHub Pages) | Visitors' IPs | The link's secret |
| The chat the link is sent in | The link. Backups, forwards and anyone holding the phone can expose it, so treat it like cash | The giver's wallet |
| Cloudflare (tunnel) | Recipient's IP, claim timing, the product chosen | The phone number, which is sealed in the browser. The giver's wallet |
| Agent operator | Recipient's IP and phone number, amount, product, code, refund address if given | The message, the giver's name, balance and other payments |
| Bitrefill | Our account, the product, the phone number for a recharge | The giver, the recipient's IP |
| Mobile carrier | The number got a recharge | Who paid |

The giver's payment and the purchase share no public transaction, because the agent buys from a prepaid balance.

## Run your own

You need Node 22.13 or later and [zcash-devtool](https://github.com/zcash/zcash-devtool) built with two testnet wallets, one for the agent.

```bash
git clone https://github.com/cryppit/zshagun && cd zshagun
npm test                     # no install step: zshagun has no npm dependencies
SHAGUN_HOME=~/fsh npm start  # dry run on :8791, buys nothing
```

You should see `shagun on :8791, dry run`. `SHAGUN_HOME` must hold `zcash-devtool/target/release/zcash-devtool`, `wallets/receiver` and
`wallets/receiver.age`.

To serve the page, run `npx serve web -l 8080`, or any static server, and open http://localhost:8080. Set `web/config.js` to your agent's URL and
wallet address. To reach it from a phone, run `cloudflared tunnel --url http://localhost:8791`, then `scripts/set-tunnel.sh`.

To buy for real, put `BITREFILL_API_KEY=…` in a file outside the repo and start with `SHAGUN_LIVE=1`. `scripts/peek.mjs` is a read-only look
at your balance and the catalog.

## Built and reused

**Built here:** the gift memo, link and key scheme, claim flow, guardrails, ledger, watcher, Bitrefill client and page.

**Reused:** zcash-devtool (wallet), the Bitrefill eCommerce MCP server (`get-product-details`, `buy-products`, `get-invoice-by-id`, `get-balances`),
Cloudflare quick tunnels, GitHub Pages, and [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT, in `web/vendor`).

**Which track uses what.** Zcash: the shielded gift, locked message, refunds and notes by memo, the privacy design. Bitrefill: purchase, delivery, guardrails.
The agent serves both.

## Design decisions

- **The recipient needs nothing.** No wallet, app or account. That is the whole point, so no screen they see uses a crypto word.
- **The secret lives in the fragment,** so servers never receive it. Sharing uses the phone's own share sheet, because a `wa.me` link would put it in a query string.
- **Two keys from one secret,** so claiming a gift doesn't hand over the message.
- **A prepaid float instead of a swap per gift.** It breaks the public link between giver and purchase, and a claim takes seconds.
- **No AI model reads claims.** The agent is rules and limits, so no model provider ever sees a phone number.
- **No third-party scripts on the page,** because it holds a secret. A Content-Security-Policy enforces that.
- **zcash-devtool as the wallet,** because it speaks NU7 today. It is not production software.

## Limits and gaps

- Testnet coins are worthless, so the demo pays real goods from a Bitrefill balance. On mainnet, refilling that float is a public step and has to be batched.
- The operator is trusted: it sees each claim, holds the float and could fail to deliver. This is custodial until a gift is claimed or refunded.
- A link works like cash. Anyone who gets it can claim the gift.
- A recharge names a phone number, and that's usually a real person. A gift card keeps it away from Bitrefill.
- A quick-tunnel URL changes on restart, which breaks claims until `web/config.js` is updated.
- A mainnet launch needs a check of the rules on reselling gift cards in India.
- One confirmation is enough to fund a gift here. Mainnet should wait for more.

MIT licence. See `LICENSE`.
