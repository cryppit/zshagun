# Feedback

From building zshagun at Free Society Hack, 4 November 2026. Everything here happened today, on real purchases.

## In my own words

The moment I'll remember is my first real ₹10 recharge. My own page told me "zshagun isn't answering". At the same time my inbox had Bitrefill's email saying they'd received my payment. So the money had moved, and nothing on my side knew about it. I didn't know if the recharge had gone through or if I'd been charged twice. I dialled `*123#` and the SIM had ₹7.47 on it. No SMS ever came. Only then did I know it worked, and that ₹10 doesn't land as ₹10.

The Flipkart card was the same kind of problem. My page showed one value, labelled PIN, and Flipkart's form wanted two. The values were there on the order, but nothing said which two a person actually types. There were four to choose from, and two of them were the same number. It took us a while, and in the end the Flipkart app itself told us which pair was right. If a person who isn't a developer got that screen, they'd have given up.

Both of these were partly my fault, because I built against what the docs said and only found out what's really sent by spending real credits. But that's my main feedback: for an agent that spends real money, one real example reply on the docs page would have saved me both problems.

What I liked: delivery is really fast, 11 to 22 seconds. Getting $25 of credits from the team at the venue was easy. And the warning never to retry a purchase is the reason my crash cost me nothing extra. One purchase, one charge.

## Bitrefill: what broke, in the order it hit us

### 1. The purchase reply is wrapped, and one docs page says it isn't

The eCommerce MCP page lists `buy-products` as returning `invoice_id`. The real reply puts it inside a `response` key, which the Partner Integration Guide does mention.

**Cost:** our first real purchase succeeded and then crashed our agent, because it read `undefined` as the invoice id. The customer's screen said the service was down while Bitrefill's email said payment was received. This is the worst place for a docs gap, because the money has already moved.

**Would have helped:** one real `buy-products` reply on the eCommerce MCP page.

### 2. The field is `invoice_status`, but the docs show `status`

Core Concepts and the eCommerce MCP page show invoices with `status`. `get-invoice-by-id` returns `invoice_status`, and `orders_delivery_status` as well. Only the Partner Integration Guide uses the real name. An agent polling `status` picks up the payment block's `status: complete` or an order's status instead.

### 3. Gift card redemption fields don't match the docs

Core Concepts lists `code`, `link`, `pin`, `expiration_date` and `extra_fields`. A real Flipkart ₹50 card returned:

```
redemption_info:
  pin:            16 digits, which is really the card number
  other:          16 letters and numbers, not needed to redeem
  instructions:   ...
  expirationTime: ...
  extraFields:
    "PIN Code":   6 digits, the actual PIN
    "Link Code":  the same 6 digits
```

So `pin` is the card number, the real PIN is in `extraFields`, `other` isn't documented, and the casing differs from the docs. The instructions say "promotional code and activation pin", which matches none of these names. Our page first showed one value, labelled PIN, and the recipient could not redeem the card. We only found the right pair by trying it in the Flipkart app.

**Would have helped:** a per-product note saying which fields the user must enter, or normalised `card_number` and `pin` fields.

### 4. `list-invoices` and `get-invoice-by-id` shape orders differently

One returns a TOON table (`orders[1]{product_id,...}:`), the other a nested list. A parser written for one misses the other. TOON suits a language model. A program spending real money would prefer JSON, so a `format: json` option on read tools would help.

### 5. A ₹10 recharge arrived as ₹7.47

Airtel ₹10 costs ₹10.65 and put ₹7.47 of talktime on the SIM. Neither the catalog nor `get-product-details` says what actually lands, so an agent can't tell the recipient the truth. We added our own note. The product instructions promise an SMS, and none arrived while we were testing, so `*123#` was our only proof.

### 6. Small mismatches that each cost time

- `package_id` on the eCommerce MCP page, `package_value` in the schema, where `package_id` is marked deprecated.
- Rate limit: 30 a minute in the guide, while the live `ratelimit` headers say 60 per 30 seconds.
- `balance_currency`: `XBT` on one page, `BTC` on another. The schema accepts both.
- Asking for `reliance-jio-india` returns `reliance-jio-india-bundles` as the id.
- No balance in the product's currency from `get-balances`. We read rupees from `account_balances` inside `get-product-details`, which we found by accident.

## Bitrefill: what was good

- Delivery was fast: 18 seconds for the recharge, about 11 for the card.
- The MCP server is stateless JSON-RPC, so plain `fetch` was enough, with no SDK.
- The advice in the event pack was right: paid isn't delivered, copy package values, prices aren't in `buy-products`.
- `PAYMENT_UNCERTAIN` and the warning never to retry shaped our design, and it's why our crash cost nothing extra: one purchase, one charge.

## Zcash

### SDK or wallet tool: zcash-devtool at 0b3436b

- `wallet list-tx --mode csv` writes memos unquoted, so a memo with a comma adds a column (11 headers, 12 cells), and rows have no txid. We parsed the text output instead.
- The text output of `list-tx` was reliable, and `send` took about 13 seconds.

### Wallet

- A normal person can't give today. We found no ready wallet that pays a ZIP 321 link on NU7 testnet, so our giver is a developer tool. This is the biggest gap for anything aimed at first-time users.

### Node or indexer

- testnet.zec.rocks is native gRPC only, so a browser can't talk to it without a proxy. That's why the agent runs server-side.
- One brief DNS failure reaching the light-wallet server during the day. The next pass recovered by itself.
