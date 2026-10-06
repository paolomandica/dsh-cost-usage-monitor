# dsh-cost-usage-monitor

A DeepSeek Harness plugin that puts **account balance** and **session usage cost** in the
composer dock, next to the built-in stats pills.

```
                                                  (gauge) $0.216 · ·  ¥42.50
```

The leading glyph is a usage gauge — a half-oval dial with a needle and a dotted scale
([`icon.svg`](https://github.com/paolomandica/dsh-cost-usage-monitor/blob/main/icon.svg), drawn inline by `UsageIcon`), not a currency symbol.

The pill is a button. It opens a panel with the billed token buckets, the cost each bucket
contributed, the live wallet (plus bonus wallets), and the price table used for the estimate.

## Where the numbers come from

| Figure | Source |
| --- | --- |
| Billed tokens | the `tokenUsage` session projection (`@deepseek-ai/dsh-token-meter`) — provider-reported `uncachedInputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `outputTokens` |
| Priced route | the `modelSelection` session projection (`@deepseek-ai/dsh-api-session-controller`) — `next` falls back to `lastUsed` |
| Balance | this plugin's Host half: it resolves the `DEEPSEEK_API_KEY` credential and serves `GET /usage-monitor/balance` from the documented [`GET /user/balance`](https://api-docs.deepseek.com/api/get-user-balance) endpoint, which the browser half then reads |
| Price per 1M tokens | this plugin — editable, persisted in `localStorage` |

The balance is fetched **Host-side on purpose**: the API key belongs to the Host,
`api.deepseek.com` serves no CORS headers, and the balance is not part of any session
projection. The browser reads its own Host's route, so the key never reaches the page:

```jsonc
// GET /usage-monitor/balance
{ "ok": true, "isAvailable": true, "fetchedAt": 1791234567890,
  "wallets": [{ "currency": "CNY", "totalBalance": "42.50",
                "grantedBalance": "5.00", "toppedUpBalance": "37.50" }] }
// failures answer 4xx/5xx with { "ok": false, "error": { "code", "message" } }
```

`401`/`403` means DeepSeek rejected the credential, `503` that no `DEEPSEEK_API_KEY` is
configured for the profile, `504` that the provider did not answer within 10 s, and `502`
that the provider or the network failed. The panel shows the message instead of waiting.

**Cost is an estimate.** The runtime reports exact token usage but carries no monetary
price for a route, so the plugin ships an editable table seeded from the provider's list
prices. The provider's billing statement is authoritative.

Defaults are DeepSeek's published **off-peak** list prices (USD per 1M tokens):

| Model | Input (cache miss) | Cache read (hit) | Cache write | Output |
| --- | --- | --- | --- | --- |
| `deepseek-flash` (DeepSeek-V4.1-Flash), `deepseek-v4-flash`, `deepseek-chat` | 0.15 | 0.003 | 0.15 | 0.6 |
| `deepseek-v4-pro`, `deepseek-reasoner` | 0.66 | 0.022 | 0.66 | 1.98 |
| any other model (fallback row) | 0.15 | 0.003 | 0.15 | 0.6 |

DeepSeek bills a **peak** tariff of twice the off-peak rate during 01:00–04:00 and
06:00–10:00 UTC, Monday to Friday. The plugin applies that factor itself — the **Peak ×**
field, 2 by default — and the panel states which tariff is in force. Chinese public
holidays are off-peak upstream but are not modelled here, so a holiday weekday is priced
at peak. `cacheWrite` has no separately published charge and mirrors the cache-miss rate.

Edit the fields for the session's current model and press **Save prices**; **Reset to
defaults** drops the override. A session whose route is not in the table is priced by the
fallback row, which the editor edits when no model is known yet. Overrides persist in
`localStorage` under `dsh-cost-usage-monitor/prices/v1`.

Prices do change. [`AGENTS.md`](https://github.com/paolomandica/dsh-cost-usage-monitor/blob/main/AGENTS.md) records where to read the current ones and the
exact steps for refreshing this table, the README table above, and the test expectations.

## Behaviour

- The entry lives in `conversation.composer.dock` (order 20, after the host stats pills)
  and stays hidden until there is something to report: measured usage, or a wallet the
  balance route actually returned.
- The balance is read on first mount, at most once per 60 s, deduplicated across mounts,
  and re-read on demand from the panel's ↻ button. The timer stops when the entry unmounts.
- No balance route in the profile → the panel says so and the cost side still works.
  A rejected credential or an unreachable provider → the panel shows the reason.
- Nothing is written to the session log, the model request, or the system prompt. The Host
  half only registers the one read-only balance route; the widget itself is a browser module
  plus existing services.

## Layout

```
package.json         dsh.bundle.patch + dsh.client (platform, inject)
cordis.patch.yml     inserts the Loader row
index.js             Host half: registers GET /usage-monitor/balance
client.js            Browser module: dock entry, panel, stores
locale/en.json       Plugin-manager display metadata
locale/zh.json
icon.svg
test/render.test.mjs Renders the browser half under a React double
test/host.test.mjs   Drives the Host balance route under webServer/credentials doubles
AGENTS.md            Where to read current prices; how to refresh them
```

## Install

From npm — the prebuilt path, so pnpm never runs a build script and the user grants no
install-time code execution:

```sh
dsh plugin --profile desktop add dsh-cost-usage-monitor
```

From GitHub installs the **source**, which carries no built entry point; pnpm runs the
package's `prepare` script after the user authorizes it. Prefer the npm form unless you are
pinning a commit you have read:

```sh
dsh plugin --profile desktop add github:paolomandica/dsh-cost-usage-monitor
```

While developing, link a checkout by absolute path:

```sh
dsh plugin --profile desktop add /path/to/dsh-cost-usage-monitor
```

`dsh plugin` runs pnpm in the profile directory and then adds every installed package
that declares `dsh.bundle` to `dsh.profile.bundles`. The Host recomposes the profile and
publishes the browser bundle live; refresh the page if the entry does not appear. Confirm
the package is composed through the page's boot graph:

```sh
curl -s -H "Cookie: <the dsh-auth cookie>" http://127.0.0.1:19387/ | grep -o 'dsh-cost-usage-monitor[^"]*'
```

The balance route needs the Web bundle's `webServer` service and a resolvable
`DEEPSEEK_API_KEY` (the credential store, or the Host process environment). Check it
directly — the route is unauthenticated on loopback, like the rest of the local server:

```sh
curl -s http://127.0.0.1:19387/usage-monitor/balance
```

## Test

```sh
node --check index.js && node --check client.js
node test/host.test.mjs
node test/render.test.mjs
```

`test/render.test.mjs` evaluates `client.js` against a minimal React double, drives `apply()`
with a fake slot registry, stubs `fetch` as the balance route, and asserts the pill and the
panel render the expected cost, wallets, and price fields — including the empty case, a
rejected credential, and an unreachable route. It freezes `Date` so the peak and off-peak
tariffs are both exercised deterministically.

`test/host.test.mjs` imports `index.js` as a plain module (which also proves the Host half
resolves no `@deepseek-ai/*` package), mounts the route over `webServer`/`credentials`
doubles, and asserts the provider request, the shaped success body, and every failure code.

## Uninstall

```sh
dsh plugin --profile desktop remove dsh-cost-usage-monitor
```

## License

MIT
