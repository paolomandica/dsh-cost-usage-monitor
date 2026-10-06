# AGENTS.md

Instructions for a coding agent working in this repository. Two recurring requests this file
exists for: **"update the prices"** — a human asking you to refresh the DeepSeek rate card
this plugin prices sessions with (§1–§4) — and **"the balance is not showing"** (§5).

Read the relevant section before editing numbers or balance code. Everything you need is here.

## 1. Where the current prices are

Use these, in this order. Do not source numbers from blogs, price-comparison sites, or model
aggregators — they lag and they mix tiers.

1. **The official pricing page (authoritative for list prices)**
   - English: <https://api-docs.deepseek.com/quick_start/pricing/>
   - Chinese: <https://api-docs.deepseek.com/zh-cn/quick_start/pricing/>
   - Fetch it and read the **Model Details** table. One column per model
     (`deepseek-flash`, `deepseek-v4-pro`, …); three priced rows, each split into
     `OFF-PEAK` and `PEAK`:
     - `1M INPUT TOKENS (CACHE HIT)` → this repo's `cacheRead`
     - `1M INPUT TOKENS (CACHE MISS)` → this repo's `input`
     - `1M OUTPUT TOKENS` → this repo's `output`
   - The same page defines the peak windows and the peak/off-peak ratio in footnotes; if
     those moved, §4 tells you what else to change.
2. **What was actually billed (authoritative for money spent)**
   - <https://platform.deepseek.com/> — the account usage/billing view. The plugin surfaces
     the same wallet through its balance route (§5).
   - If the user's effective rates differ from the list page (contract, credits, a legacy
     plan), the platform view is the number that matters — ask before hard-coding a
     deviation as a default.
3. **Model identity** — the column header is the API model id. `deepseek-flash` is served by
   DeepSeek-V4.1-Flash; the page's footnotes name the underlying version and any retired
   aliases (`deepseek-v4-flash`, …) that are still accepted and billed at the same rate.

If the official page cannot be fetched, **stop and say so**. Never guess numbers or reuse a
previous snapshot as if it were fresh.

## 2. How this plugin models the rate card

- `DEFAULT_PRICES` in [`client.js`](client.js) holds **off-peak** list prices in USD per
  1M tokens, one row per model id: `{ input, cacheRead, cacheWrite, output }`.
- `PEAK_WINDOWS_UTC` and `isPeak(at)` decide the tariff from the clock; the peak price is
  `peakMultiplier` (default `2`) times the off-peak row. The panel shows a **Peak ×** field
  and a line stating which tariff is in force.
- `cacheWrite` has no separately published DeepSeek charge, so it mirrors `input`. Keep that
  invariant unless the provider starts billing cache writes on their own line.
- `fallback` prices sessions whose route is not in `models`; `default` prices the editor when
  no model is known yet.
- Users can override any row in the panel. Those overrides are persisted under the
  `localStorage` key `dsh-usage-monitor/prices/v1` and **shadow the shipped defaults**, so
  editing `DEFAULT_PRICES` does not reach anyone who already saved a table. Bump the key to
  `…/v2` only if the user asks for new defaults to reach existing users; that silently
  discards their overrides, so it is a decision to confirm, not a default move.

## 3. Refreshing the table — the steps

1. Fetch the official pricing page (§1) and read the table plus its peak footnotes.
2. Map each model column onto a `DEFAULT_PRICES.models` key. Keep existing keys working:
   retired aliases stay listed and point at the rate of the model that now serves them.
3. Edit `DEFAULT_PRICES` in `client.js` — off-peak values only. Update `peakMultiplier` and
   `PEAK_WINDOWS_UTC` only if the page says the ratio or the windows changed.
4. Update the defaults table in [`README.md`](README.md) so the docs match the code.
5. Update the expected cost in [`test/render.test.mjs`](test/render.test.mjs). The rendered
   fixture is 1M uncached input + 2M cache read + 0M cache write + 0.1M output, so
   `cost = 1 × input + 2 × cacheRead + 0.1 × output`, and the peak assertion is that value
   times `peakMultiplier`. Today those are `$0.216` (off-peak) and `$0.432` (peak).
6. Update the snapshot in §4 below, including the date you verified it.
7. Verify:
   ```sh
   node --check index.js && node --check client.js
   node test/host.test.mjs && node test/render.test.mjs
   ```
8. Commit, naming the source and the date in the message, e.g.
   `Update Flash prices to the 2026-10-06 rate card (api-docs.deepseek.com/quick_start/pricing)`.

Report the old and new numbers to the user when you finish, and flag anything the page
changed that this table cannot express (a new priced bucket, a third tier, per-model peak
ratios) instead of quietly approximating it.

## 4. Rate card in force

Verified against the official pricing page on **2026-10-06**.

| Model id(s) | Input (cache miss) | Cache read (hit) | Cache write | Output |
| --- | --- | --- | --- | --- |
| `deepseek-flash`, `deepseek-v4-flash`, `deepseek-chat` (DeepSeek-V4.1-Flash) | 0.15 | 0.003 | 0.15 | 0.6 |
| `deepseek-v4-pro`, `deepseek-reasoner` (DeepSeek-V4-Pro-0813) | 0.66 | 0.022 | 0.66 | 1.98 |
| fallback row | 0.15 | 0.003 | 0.15 | 0.6 |

USD per 1M tokens, **off-peak**. Peak is `2 ×` these values, inside 01:00–04:00 and
06:00–10:00 UTC, Monday to Friday. Chinese public holidays are off-peak upstream and are not
modelled by this plugin, so a holiday weekday is priced at peak.

## 5. The balance route

The account balance is **not** read from a Harness Remote. An earlier revision called
`ctx.remote.account.getBalance(...)`, which never settled in the desktop composition — the
panel sat on "Reading the balance…" forever. The balance now comes from the documented
REST endpoint, fetched by the Host half:

- **Endpoint**: `GET https://api.deepseek.com/user/balance`, `Authorization: Bearer <key>`.
  Docs: <https://api-docs.deepseek.com/api/get-user-balance> (zh: `/zh-cn/api/get-user-balance`).
  It answers `{ is_available, balance_infos: [{ currency, total_balance, granted_balance,
  topped_up_balance }] }`. It is free to call and bills no tokens.
- **Key**: the `DEEPSEEK_API_KEY` credential. `resolveApiKey()` asks `ctx.get('credentials')`
  first with `credentials.resolve('DEEPSEEK_API_KEY')` and falls back to `process.env`. Read
  per request, never cached, so a rotated key reaches the next call.
- **Transport**: `index.js` registers one exact route on `ctx.get('webServer')` —
  `GET /usage-monitor/balance` — and shapes the provider payload. The browser registers no
  Remote and never sees the key. `index.js` deliberately imports no `@deepseek-ai/*` package:
  the plugin is installed as a `link:` and resolves modules from this directory, where no
  harness package exists, so a static harness import would fail at load.
- **Contract**: `200 { ok, isAvailable, fetchedAt, wallets: [{ currency, totalBalance,
  grantedBalance, toppedUpBalance }] }`, otherwise `{ ok: false, error: { code, message } }`
  with `401` rejected credential, `503` no credential, `504` provider timeout (10 s), `502`
  provider or network fault, `405` non-GET. The client maps those to the panel's wallet rows
  or its failure line; nothing waits indefinitely.

Debugging "the balance is not showing":

1. `curl -s http://127.0.0.1:19387/usage-monitor/balance` — the route is unauthenticated on
   loopback. `404` means the Host half did not activate, which almost always means the
   composition provides no `webServer` service (the plugin declares `inject: ['webServer']`).
2. Read the `error.code` the route returns and act on it: `no-credential` → the profile has
   no `DEEPSEEK_API_KEY`; `unauthorized` → the key is wrong or revoked; `network`/`timeout` →
   the Host could not reach `api.deepseek.com`.
3. `node test/host.test.mjs` covers every one of those codes without touching the network.

If you change the route path, the response shape, or the credential reference, update
`client.js`, this section, the README table, and both tests in the same change.
