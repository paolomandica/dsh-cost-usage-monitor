# AGENTS.md

Instructions for a coding agent working in this repository. The one recurring request this
file exists for is **"update the prices"** — a human asking you to refresh the DeepSeek rate
card this plugin prices sessions with.

Read the whole file before editing numbers. Everything you need is here.

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
   - <https://platform.deepseek.com/> — the account usage/billing view, and
     `ctx.remote.account.getBalance(...)`, which the plugin already surfaces.
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
   node test/render.test.mjs
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
