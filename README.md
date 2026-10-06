# dsh-usage-monitor

A DeepSeek Harness plugin that puts **account balance** and **session usage cost** in the
composer dock, next to the built-in stats pills.

```
                                                        ⌾ $0.378 · ·  ¥42.50
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
price for a route, so the plugin ships a placeholder table and lets you correct it. The
provider's billing statement is authoritative.

Defaults (USD per 1M tokens):

| Model | Input | Cache read | Cache write | Output |
| --- | --- | --- | --- | --- |
| `deepseek-flash`, `deepseek-v4-flash`, `deepseek-chat` | 0.28 | 0.028 | 0.28 | 0.42 |
| `deepseek-v4-pro`, `deepseek-reasoner` | 0.55 | 0.14 | 0.55 | 2.19 |
| any other model (fallback row) | 0.28 | 0.028 | 0.28 | 0.42 |

Edit the four fields for the session's current model and press **Save prices**; use
**Reset to defaults** to drop the override. A session whose route is not in the table is
priced by the fallback row, which the editor edits when no model is known yet.

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
no-account-namespace cases.

## Uninstall

```sh
dsh plugin --profile desktop remove dsh-usage-monitor
```

## License

MIT
