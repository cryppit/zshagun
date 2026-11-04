# Feedback for Bitrefill

From building zshagun at Free Society Hack, 4 November 2026. Everything here happened today, on real purchases.

## In my own words

<!-- The founder writes this part. -->

## What broke, in the order it hit us

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

## What was good

- Delivery was fast: 18 seconds for the recharge, about 11 for the card.
- The MCP server is stateless JSON-RPC, so plain `fetch` was enough, with no SDK.
- The advice in the event pack was right: paid isn't delivered, copy package values, prices aren't in `buy-products`.
- `PAYMENT_UNCERTAIN` and the warning never to retry shaped our design, and it's why our crash cost nothing extra: one purchase, one charge.
