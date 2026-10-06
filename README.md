# dsh-usage-monitor

A DeepSeek Harness plugin that puts **account balance** and **session usage cost** in the
composer dock, next to the built-in stats pills.

```
                                                        $ $0.216 · ·  ¥42.50
```

The pill is a button. It opens a panel with the billed token buckets, the cost each bucket
contributed, the live wallet (plus bonus wallets), and the price table used for the estimate.

## Where the numbers come from

| Figure | Source |
| --- | --- |
| Billed tokens | the `tokenUsage` session projection (`@deepseek-ai/dsh-token-meter`) — provider-reported `uncachedInputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `outputTokens` |
| Priced route | the `modelSelection` session projection (`@deepseek-ai/dsh-api-session-controller`) — `next` falls back to `lastUsed` |
| Balance | `ctx.remote.account.getBalance(...)` — the existing account Remote namespace (`@deepseek-ai/dsh-api-account-controller`), i.e. the same wallet the Account settings page shows |
| Price per 1M tokens | this plugin — editable, persisted in `localStorage` |

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
`localStorage` under `dsh-usage-monitor/prices/v1`.

Prices do change. [`AGENTS.md`](AGENTS.md) records where to read the current ones and the
exact steps for refreshing this table, the README table above, and the test expectations.

## Behaviour

- The entry lives in `conversation.composer.dock` (order 20, after the host stats pills)
  and stays hidden until there is something to report: measured usage, or a wallet the
  account service actually returned.
- The balance is read on first mount, at most once per 60 s, deduplicated across mounts,
  and re-read on demand from the panel's ↻ button. The timer stops when the entry unmounts.
- No account service in the profile → the panel says so and the cost side still works.
  Signed out → the balance side says so and the cost side still works.
- Nothing is written to the session log, the model request, or the system prompt. The Host
  half is an empty `apply()`; the feature is entirely a browser module plus existing services.

## Layout

```
package.json         dsh.bundle.patch + dsh.client (platform, inject)
cordis.patch.yml     inserts the Loader row
index.js             Host half: no-op apply()
client.js            Browser module: dock entry, panel, stores
locale/en.json       Plugin-manager display metadata
locale/zh.json
icon.svg
test/render.test.mjs Renders the browser half under a React double
AGENTS.md            Where to read current prices; how to refresh them
```

## Install

```sh
dsh plugin --profile desktop add /Users/paolo/dev/dsh-usage-monitor
```

`dsh plugin` runs pnpm in the profile directory and then adds every installed package
that declares `dsh.bundle` to `dsh.profile.bundles`. The Host recomposes the profile and
publishes the browser bundle live; refresh the page if the entry does not appear. Confirm
the package is composed through the page's boot graph:

```sh
curl -s -H "Cookie: <the dsh-auth cookie>" http://127.0.0.1:19387/ | grep -o 'dsh-usage-monitor[^"]*'
```

## Test

```sh
node --check index.js && node --check client.js
node test/render.test.mjs
```

The test evaluates `client.js` against a minimal React double, drives `apply()` with a fake
slot registry, resolves a fake account Remote, and asserts the pill and the panel render the
expected cost, wallets, and price fields — including the empty, signed-out, and
no-account-namespace cases. It freezes `Date` so the peak and off-peak tariffs are both
exercised deterministically.

## Uninstall

```sh
dsh plugin --profile desktop remove dsh-usage-monitor
```

## License

MIT
