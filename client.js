/**
 * dsh-usage-monitor — browser half.
 *
 * Registers one entry into the composer dock (`conversation.composer.dock`)
 * that reads two existing session projections and one existing Remote
 * namespace; it adds no Host surface of its own:
 *
 *   - `tokenUsage`      provider-reported billed tokens for the whole log
 *   - `modelSelection`  the route the session last used / will use next
 *   - `ctx.remote.account.getBalance`  the signed-in DeepSeek account wallet
 *
 * Cost is an estimate: token counts are exact provider usage, but the price
 * table ships with editable defaults (per 1M tokens) because prices are not
 * part of the runtime's model metadata. Overrides persist in localStorage.
 */
window.__ModuleLoader__.load({
	id: "dsh-usage-monitor",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const ReactDOM = require("react-dom");
		const h = React.createElement;

		//#region lib/types/client/locales.js
		/** Locale namespace for the dock entry and its panel. */
		const NS = "usageMonitor";
		const en = {
			"pill.title": "Usage & balance",
			"pill.open": "Show session usage and account balance",
			"pill.cost": "Session cost {amount}",
			"pill.balance": "Balance {amount}",
			"pill.unavailable": "Usage and balance",
			"panel.title": "Usage & balance",
			"panel.close": "Close",
			"section.cost": "Session cost",
			"section.balance": "Account balance",
			"section.prices": "Price per 1M tokens",
			"row.input": "Input (uncached)",
			"row.cacheRead": "Cache read",
			"row.cacheWrite": "Cache write",
			"row.output": "Output",
			"row.total": "Total",
			"row.bonus": "Bonus",
			"row.pricedModel": "Priced model",
			"row.provider": "Provider",
			"row.currency": "Currency",
			"money.input": "Input",
			"money.cacheRead": "Cache read",
			"money.cacheWrite": "Cache write",
			"money.output": "Output",
			"balance.signedOut": "No DeepSeek account is signed in, so the balance is unavailable.",
			"balance.unavailable": "This profile composes no account service, so the balance is unavailable.",
			"balance.failed": "The balance could not be read.",
			"balance.loading": "Reading the balance…",
			"balance.refresh": "Refresh balance",
			"balance.updated": "Updated {time}",
			"prices.save": "Save prices",
			"prices.saved": "Prices saved",
			"prices.reset": "Reset to defaults",
			"prices.note": "Defaults are placeholders for the advertised DeepSeek routes; adjust them to your plan.",
			"panel.footnote": "Cost is estimated from provider-reported token usage and the price table above. The provider's own billing statement is authoritative.",
			"model.unknown": "unknown",
		};
		const zh = {
			"pill.title": "用量与余额",
			"pill.open": "查看会话用量与账户余额",
			"pill.cost": "会话费用 {amount}",
			"pill.balance": "余额 {amount}",
			"pill.unavailable": "用量与余额",
			"panel.title": "用量与余额",
			"panel.close": "关闭",
			"section.cost": "会话费用",
			"section.balance": "账户余额",
			"section.prices": "每百万 Token 价格",
			"row.input": "输入（未命中缓存）",
			"row.cacheRead": "缓存读取",
			"row.cacheWrite": "缓存写入",
			"row.output": "输出",
			"row.total": "合计",
			"row.bonus": "赠送",
			"row.pricedModel": "计价模型",
			"row.provider": "提供方",
			"row.currency": "币种",
			"money.input": "输入",
			"money.cacheRead": "缓存读取",
			"money.cacheWrite": "缓存写入",
			"money.output": "输出",
			"balance.signedOut": "当前未登录 DeepSeek 账户，无法获取余额。",
			"balance.unavailable": "当前配置未提供账户服务，无法获取余额。",
			"balance.failed": "余额读取失败。",
			"balance.loading": "正在读取余额…",
			"balance.refresh": "刷新余额",
			"balance.updated": "更新于 {time}",
			"prices.save": "保存价格",
			"prices.saved": "价格已保存",
			"prices.reset": "恢复默认",
			"prices.note": "默认值仅为已公布 DeepSeek 路由的占位价格，请按你的实际套餐调整。",
			"panel.footnote": "费用由提供商上报的 Token 用量与上表价格估算，实际计费以提供商账单为准。",
			"model.unknown": "未知",
		};
		//#endregion

		//#region lib/types/client/format.js
		/** Currency glyphs for the two wallet currencies the account reports. */
		const CURRENCY_SYMBOL = { USD: "$", CNY: "\u00a5" };
		/** Billing bucket field → price field. */
		const BUCKETS = [
			{ usage: "uncachedInputTokens", price: "input" },
			{ usage: "cacheReadTokens", price: "cacheRead" },
			{ usage: "cacheWriteTokens", price: "cacheWrite" },
			{ usage: "outputTokens", price: "output" },
		];
		/**
		 * Prefix one amount with its currency glyph, or its code when unknown.
		 * @param currency - ISO currency code.
		 * @returns display prefix.
		 */
		function currencyPrefix(currency) {
			if (currency === void 0 || currency === "") return "";
			return CURRENCY_SYMBOL[currency] ?? currency + " ";
		}
		/**
		 * Format an estimated amount with precision that stays informative near zero.
		 * @param value - amount in the price table's currency.
		 * @param currency - ISO currency code.
		 * @returns display string.
		 */
		function formatCost(value, currency) {
			if (!Number.isFinite(value) || value <= 0) return currencyPrefix(currency) + "0.00";
			const abs = Math.abs(value);
			const digits = abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
			return currencyPrefix(currency) + value.toFixed(digits);
		}
		/**
		 * Render a host-supplied balance string unchanged, glyph-prefixed.
		 * @param balance - decimal string from the account service.
		 * @param currency - its currency code.
		 * @returns display string.
		 */
		function formatWallet(balance, currency) {
			const text = typeof balance === "string" ? balance : String(balance ?? "");
			return currencyPrefix(currency) + text;
		}
		/**
		 * Compact token count: 517 / 12.2K / 1.2M.
		 * @param n - token count.
		 * @returns display string.
		 */
		function formatTokens(n) {
			if (!Number.isFinite(n) || n <= 0) return "0";
			if (n < 1000) return String(Math.round(n));
			const scaled = n < 1e6 ? n / 1e3 : n / 1e6;
			const rounded = Math.round(scaled * 10) / 10;
			const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
			return text + (n < 1e6 ? "K" : "M");
		}
		/**
		 * Clock time for the last successful balance read.
		 * @param at - epoch milliseconds.
		 * @returns localized short time.
		 */
		function formatClock(at) {
			try {
				return new Date(at).toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit" });
			} catch (_error) {
				return new Date(at).toISOString().slice(11, 16);
			}
		}
		//#endregion

		//#region lib/types/client/prices.js
		/** localStorage key holding the persisted price table. */
		const PRICE_KEY = "dsh-usage-monitor/prices/v1";
		/** Key the editor writes when the session reports no model yet. */
		const FALLBACK_MODEL_KEY = "default";
		/** Editable price defaults, in USD per 1M tokens, for the advertised routes. */
		const DEFAULT_PRICES = {
			currency: "USD",
			fallback: { input: 0.28, cacheRead: 0.028, cacheWrite: 0.28, output: 0.42 },
			models: {
				default: { input: 0.28, cacheRead: 0.028, cacheWrite: 0.28, output: 0.42 },
				"deepseek-flash": { input: 0.28, cacheRead: 0.028, cacheWrite: 0.28, output: 0.42 },
				"deepseek-v4-flash": { input: 0.28, cacheRead: 0.028, cacheWrite: 0.28, output: 0.42 },
				"deepseek-v4-pro": { input: 0.55, cacheRead: 0.14, cacheWrite: 0.55, output: 2.19 },
				"deepseek-chat": { input: 0.28, cacheRead: 0.028, cacheWrite: 0.28, output: 0.42 },
				"deepseek-reasoner": { input: 0.55, cacheRead: 0.14, cacheWrite: 0.55, output: 2.19 },
			},
		};
		/**
		 * Coerce one stored price row, dropping anything non-numeric.
		 * @param raw - candidate row.
		 * @param base - defaults to fall back to per field.
		 * @returns a complete price row.
		 */
		function normalizePrice(raw, base) {
			const out = {};
			for (const field of ["input", "cacheRead", "cacheWrite", "output"]) {
				const value = raw === void 0 || raw === null ? void 0 : Number(raw[field]);
				out[field] = Number.isFinite(value) && value >= 0 ? value : base[field];
			}
			return out;
		}
		/**
		 * Read the persisted table, tolerating absent, malformed, or older payloads.
		 * @returns a complete price table.
		 */
		function loadPrices() {
			let raw;
			try {
				raw = JSON.parse(globalThis.localStorage?.getItem(PRICE_KEY) ?? "null");
			} catch (_error) {
				raw = null;
			}
			const models = {};
			const source = raw !== null && typeof raw === "object" && raw.models !== void 0 && raw.models !== null ? raw.models : {};
			for (const key of Object.keys(DEFAULT_PRICES.models)) {
				models[key] = normalizePrice(source[key], DEFAULT_PRICES.models[key]);
			}
			for (const key of Object.keys(source)) {
				if (models[key] === void 0) models[key] = normalizePrice(source[key], DEFAULT_PRICES.fallback);
			}
			return {
				currency: typeof raw?.currency === "string" && raw.currency !== "" ? raw.currency : DEFAULT_PRICES.currency,
				fallback: normalizePrice(raw?.fallback, DEFAULT_PRICES.fallback),
				models,
			};
		}
		/**
		 * Build the editable price store shared by every mount of the entry.
		 * @returns a snapshot store with price mutations.
		 */
		function createPriceStore() {
			let state = loadPrices();
			const listeners = new Set();
			const publish = (next) => {
				state = next;
				try {
					globalThis.localStorage?.setItem(PRICE_KEY, JSON.stringify(next));
				} catch (_error) {
					/* private mode or a full quota: the in-memory table still works */
				}
				for (const listener of listeners) listener();
			};
			return {
				getSnapshot: () => state,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				setCurrency: (currency) => {
					if (currency === state.currency) return;
					publish({ ...state, currency });
				},
				setModelPrice: (model, price) => {
					publish({ ...state, models: { ...state.models, [model]: normalizePrice(price, state.fallback) } });
				},
				resetModel: (model) => {
					const base = DEFAULT_PRICES.models[model] ?? DEFAULT_PRICES.fallback;
					publish({ ...state, currency: DEFAULT_PRICES.currency, models: { ...state.models, [model]: { ...base } } });
				},
			};
		}
		/**
		 * The price row that applies to one model id.
		 * @param table - current price table.
		 * @param model - resolved model id, when known.
		 * @returns the applicable price row.
		 */
		function priceFor(table, model) {
			if (model !== void 0 && table.models[model] !== void 0) return table.models[model];
			if (table.models[FALLBACK_MODEL_KEY] !== void 0) return table.models[FALLBACK_MODEL_KEY];
			return table.fallback;
		}
		/**
		 * Price one usage projection's four disjoint buckets.
		 * @param usage - `tokenUsage` projection value.
		 * @param price - per-1M-token price row.
		 * @returns total estimated amount.
		 */
		function costOf(usage, price) {
			let total = 0;
			for (const bucket of BUCKETS) total += (Number(usage[bucket.usage]) || 0) / 1e6 * price[bucket.price];
			return total;
		}
		//#endregion

		//#region lib/types/client/balance.js
		/** Minimum interval between automatic balance reads. */
		const BALANCE_TTL_MS = 60000;
		/** Best-effort build identity for the account call's client metadata. */
		const CLIENT_VERSION = globalThis.__DSH_CLIENT_VERSION__ ?? "0.2.0-rc.2";
		/**
		 * Build the calling-UI identity the account Remote methods carry.
		 * @param ctx - browser plugin context.
		 * @returns account client metadata.
		 */
		function accountMetadata(ctx) {
			let locale = "en";
			try {
				locale = ctx.get("locale")?.getSnapshot()?.active ?? "en";
			} catch (_error) {
				/* a composition without the locale service still reaches the Host */
			}
			return {
				version: CLIENT_VERSION,
				locale,
				timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
			};
		}
		/**
		 * Build the shared account-balance store. Reads are TTL-cached, deduped,
		 * and only run while at least one entry is mounted.
		 * @param ctx - browser plugin context.
		 * @returns a snapshot store with a `refresh` action.
		 */
		function createBalanceStore(ctx) {
			let state = { status: "idle", wallets: [], bonusWallets: [], at: 0, error: null };
			const listeners = new Set();
			let inflight = null;
			let timer = null;
			const publish = (next) => {
				state = next;
				for (const listener of listeners) listener();
			};
			/**
			 * Resolve the account namespace, which exists only where the
			 * composition mounts the account Remote contribution.
			 * @returns the namespace, or undefined.
			 */
			const namespace = () => {
				const remote = ctx.get("remote");
				return remote === void 0 ? void 0 : remote.account;
			};
			const read = (force) => {
				const account = namespace();
				if (account === void 0 || typeof account.getBalance !== "function") {
					publish({ status: "unavailable", wallets: [], bonusWallets: [], at: Date.now(), error: null });
					return Promise.resolve(state);
				}
				if (!force && state.status === "ready" && Date.now() - state.at < BALANCE_TTL_MS) return Promise.resolve(state);
				if (inflight !== null) return inflight;
				inflight = (async () => {
					try {
						const result = await account.getBalance(accountMetadata(ctx));
						if (result === void 0 || result.ok !== true) {
							const error = result === void 0 ? void 0 : result.error;
							publish({
								status: "failed",
								wallets: [],
								bonusWallets: [],
								at: Date.now(),
								error: typeof error?.message === "string" ? error.message : typeof error?.code === "string" ? error.code : null,
							});
						} else if (result.value === null) {
							publish({ status: "signed-out", wallets: [], bonusWallets: [], at: Date.now(), error: null });
						} else if (result.value?.status === "ready") {
							publish({
								status: "ready",
								wallets: Array.isArray(result.value.value) ? result.value.value : [],
								bonusWallets: Array.isArray(result.value.bonusWallets) ? result.value.bonusWallets : [],
								at: Date.now(),
								error: null,
							});
						} else {
							publish({ status: "failed", wallets: [], bonusWallets: [], at: Date.now(), error: null });
						}
					} catch (error) {
						publish({
							status: "failed",
							wallets: [],
							bonusWallets: [],
							at: Date.now(),
							error: error instanceof Error ? error.message : String(error),
						});
					} finally {
						inflight = null;
					}
					return state;
				})();
				return inflight;
			};
			return {
				getSnapshot: () => state,
				subscribe: (listener) => {
					listeners.add(listener);
					if (listeners.size === 1) {
						read(false);
						timer = setInterval(() => {
							read(false);
						}, BALANCE_TTL_MS);
					}
					return () => {
						listeners.delete(listener);
						if (listeners.size === 0 && timer !== null) {
							clearInterval(timer);
							timer = null;
						}
					};
				},
				refresh: () => read(true),
			};
		}
		//#endregion

		//#region lib/types/client/styles.js
		/** Scoped stylesheet; class names carry a plugin prefix and only theme tokens color it. */
		const CSS = [
			".dum_root{box-sizing:border-box;min-width:0;display:inline-flex}",
			".dum_trigger{border:0;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer;border-radius:999px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}",
			".dum_trigger:hover,.dum_trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
			".dum_trigger svg{flex:none;width:14px;height:14px}",
			".dum_sep{color:var(--dsw-alias-separator-primary);margin:0 5px}",
			".dum_panel{z-index:1100;position:fixed;box-sizing:border-box;width:340px;min-width:min(300px,100vw - 24px);max-width:min(340px,100vw - 24px);overflow:auto;overscroll-behavior:contain;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:14px 16px 16px}",
			".dum_title{color:var(--dsw-alias-label-primary);font-weight:500;justify-content:space-between;align-items:center;gap:16px;display:flex}",
			".dum_titleLabel{align-items:center;gap:6px;min-width:0;display:inline-flex}",
			".dum_titleLabel svg{flex:none;width:14px;height:14px}",
			".dum_iconButton{border:0;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;border-radius:var(--dsw-radius-sm);padding:0 4px;line-height:16px}",
			".dum_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
			".dum_rule{border-top:.5px solid var(--dsw-alias-border-l2);margin:8px 0 10px}",
			".dum_section{margin-top:14px}",
			".dum_section:first-of-type{margin-top:0}",
			".dum_sectionTitle{color:var(--dsw-alias-label-primary);font-weight:500;justify-content:space-between;align-items:center;gap:12px;margin-bottom:6px;display:flex}",
			".dum_rows{grid-template-columns:minmax(96px,auto) minmax(0,1fr);gap:4px 12px;margin:0;display:grid}",
			".dum_rows dt,.dum_rows dd{min-width:0;margin:0}",
			".dum_rows dt{color:var(--dsw-alias-label-tertiary)}",
			".dum_rows dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}",
			".dum_rows dt.dum_strong,.dum_rows dd.dum_strong{color:var(--dsw-alias-label-primary)}",
			".dum_wallet{justify-content:space-between;gap:12px;display:flex}",
			".dum_walletTag{color:var(--dsw-alias-label-tertiary);margin-left:6px}",
			".dum_hint{color:var(--dsw-alias-label-tertiary);margin-top:6px}",
			".dum_error{color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}",
			".dum_grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;display:grid}",
			".dum_field{justify-content:space-between;align-items:center;gap:8px;display:flex}",
			".dum_fieldLabel{color:var(--dsw-alias-label-tertiary)}",
			".dum_input{box-sizing:border-box;width:88px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-variant-numeric:tabular-nums;text-align:right;padding:2px 6px}",
			".dum_select{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-primary);font:inherit;padding:2px 6px}",
			".dum_actions{justify-content:flex-end;align-items:center;gap:8px;margin-top:10px;display:flex}",
			".dum_button{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;padding:3px 10px}",
			".dum_button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			".dum_button[disabled]{cursor:default;opacity:.5}",
			".dum_footnote{color:var(--dsw-alias-label-tertiary);border-top:.5px solid var(--dsw-alias-border-l2);margin-top:12px;padding-top:8px}",
		].join("");
		/**
		 * Install the plugin stylesheet once per document.
		 * @returns nothing.
		 */
		function installStyles() {
			if (typeof document === "undefined") return;
			const tagId = "dsh-usage-monitor/client.css";
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-usage-monitor";
			tag.dataset.pluginCss = tagId;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region lib/types/client/UsageIcon.js
		/**
		 * Small balance/usage glyph matching the composer pill metrics.
		 * @returns the icon element.
		 */
		function UsageIcon() {
			return h(
				"svg",
				{ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
				h("path", { key: "a", d: "M3 17.5V9.2a2 2 0 0 1 2-2h2.3" }),
				h("path", { key: "b", d: "M3 13.4h6.6" }),
				h("circle", { key: "c", cx: 16.2, cy: 9.1, r: 5 }),
				h("path", { key: "d", d: "M16.2 6.9v4.4" }),
				h("path", { key: "e", d: "M18.1 8.1c-.4-.6-1.1-.9-1.9-.9-1.1 0-2 .6-2 1.5s.9 1.4 2 1.4 2 .5 2 1.4-.9 1.5-2 1.5c-.8 0-1.5-.3-1.9-.9" }),
				h("path", { key: "f", d: "M7.4 17.5h9.9" }),
			);
		}
		//#endregion

		//#region lib/types/client/Panel.js
		/** Currencies the price table may be expressed in. */
		const PRICE_CURRENCIES = ["USD", "CNY"];
		/** Panel width in CSS pixels; mirrors .dum_panel. */
		const PANEL_WIDTH = 340;
		/**
		 * One editable price field.
		 * @param props - label, value, and change handler.
		 * @returns the field element.
		 */
		function PriceField({ label, value, onChange }) {
			return h(
				"label",
				{ className: "dum_field" },
				h("span", { className: "dum_fieldLabel" }, label),
				h("input", {
					className: "dum_input",
					type: "text",
					inputMode: "decimal",
					value,
					onChange: (event) => onChange(event.target.value),
				}),
			);
		}
		/**
		 * The detail panel: session cost, live account balance, and the price table.
		 * @param props - projection reads, stores, locale, and dismissal.
		 * @returns the panel element.
		 */
		function Panel({ usage, model, provider, prices, price, costs, balance, style, panelRef, t, onClose, onRefresh, onSave, onReset, onCurrency }) {
			const [draft, setDraft] = React.useState(() => ({
				input: String(price.input),
				cacheRead: String(price.cacheRead),
				cacheWrite: String(price.cacheWrite),
				output: String(price.output),
			}));
			const [saved, setSaved] = React.useState(false);
			const modelKey = model ?? "";
			React.useEffect(() => {
				setDraft({
					input: String(price.input),
					cacheRead: String(price.cacheRead),
					cacheWrite: String(price.cacheWrite),
					output: String(price.output),
				});
				setSaved(false);
			}, [modelKey]);
			const parsed = (key) => {
				const value = Number(draft[key]);
				return Number.isFinite(value) && value >= 0 ? value : 0;
			};
			const walletRows = [];
			for (let index = 0; index < balance.wallets.length; index += 1) {
				const wallet = balance.wallets[index];
				walletRows.push(
					h("div", { className: "dum_wallet", key: "w" + index }, h("span", null, t("section.balance")), h("span", null, formatWallet(wallet?.balance, wallet?.currency))),
				);
			}
			for (let index = 0; index < balance.bonusWallets.length; index += 1) {
				const wallet = balance.bonusWallets[index];
				walletRows.push(
					h(
						"div",
						{ className: "dum_wallet", key: "b" + index },
						h("span", null, t("row.bonus"), h("span", { className: "dum_walletTag" }, wallet?.currency ?? "")),
						h("span", null, formatWallet(wallet?.balance, wallet?.currency)),
					),
				);
			}
			let balanceBody;
			if (balance.status === "ready") {
				balanceBody = h(
					React.Fragment,
					null,
					...walletRows,
					h("div", { className: "dum_hint" }, t("balance.updated", { time: formatClock(balance.at) })),
				);
			} else if (balance.status === "signed-out") {
				balanceBody = h("div", { className: "dum_hint" }, t("balance.signedOut"));
			} else if (balance.status === "unavailable") {
				balanceBody = h("div", { className: "dum_hint" }, t("balance.unavailable"));
			} else if (balance.status === "failed") {
				balanceBody = h(
					React.Fragment,
					null,
					h("div", { className: "dum_hint" }, t("balance.failed")),
					balance.error === null ? null : h("div", { className: "dum_error" }, balance.error),
				);
			} else {
				balanceBody = h("div", { className: "dum_hint" }, t("balance.loading"));
			}
			const totalTokens = usage === void 0 ? 0 : BUCKETS.reduce((sum, bucket) => sum + (Number(usage[bucket.usage]) || 0), 0);
			const costRows = [];
			for (const bucket of BUCKETS) {
				const tokens = usage === void 0 ? 0 : Number(usage[bucket.usage]) || 0;
				costRows.push(
					h("dt", { key: bucket.price + "t" }, t("row." + rowKeyFor(bucket.price))),
					h("dd", { key: bucket.price + "v" }, formatTokens(tokens) + "  \u00b7  " + formatCost(costs[bucket.price], prices.currency)),
				);
			}
			costRows.push(
				h("dt", { className: "dum_strong", key: "total-t" }, t("row.total")),
				h("dd", { className: "dum_strong", key: "total-v" }, formatTokens(totalTokens) + "  \u00b7  " + formatCost(costs.total, prices.currency)),
			);
			return h(
				"div",
				{ className: "dum_panel", role: "dialog", "aria-label": t("panel.title"), style, ref: panelRef },
				h(
					"div",
					{ className: "dum_title" },
					h("span", { className: "dum_titleLabel" }, h(UsageIcon, null), t("panel.title")),
					h("button", { type: "button", className: "dum_iconButton", onClick: onClose, "aria-label": t("panel.close") }, "\u2715"),
				),
				h("div", { className: "dum_rule" }),
				h(
					"div",
					{ className: "dum_section" },
					h("div", { className: "dum_sectionTitle" }, t("section.cost")),
					h("dl", { className: "dum_rows" }, ...costRows),
					h(
						"div",
						{ className: "dum_hint" },
						t("row.pricedModel") + ": " + (model ?? t("model.unknown")) + (provider === void 0 ? "" : " \u00b7 " + provider),
					),
				),
				h(
					"div",
					{ className: "dum_section" },
					h(
						"div",
						{ className: "dum_sectionTitle" },
						t("section.balance"),
						h("button", { type: "button", className: "dum_iconButton", onClick: onRefresh, "aria-label": t("balance.refresh") }, "\u21bb"),
					),
					balanceBody,
				),
				h(
					"div",
					{ className: "dum_section" },
					h("div", { className: "dum_sectionTitle" }, t("section.prices")),
					h(
						"div",
						{ className: "dum_grid" },
						h(
							"label",
							{ className: "dum_field" },
							h("span", { className: "dum_fieldLabel" }, t("row.currency")),
							h(
								"select",
								{ className: "dum_select", value: prices.currency, onChange: (event) => onCurrency(event.target.value) },
								...PRICE_CURRENCIES.map((code) => h("option", { key: code, value: code }, code)),
							),
						),
						h(PriceField, { label: t("money.input"), value: draft.input, onChange: (value) => setDraft({ ...draft, input: value }) }),
						h(PriceField, { label: t("money.cacheRead"), value: draft.cacheRead, onChange: (value) => setDraft({ ...draft, cacheRead: value }) }),
						h(PriceField, { label: t("money.cacheWrite"), value: draft.cacheWrite, onChange: (value) => setDraft({ ...draft, cacheWrite: value }) }),
						h(PriceField, { label: t("money.output"), value: draft.output, onChange: (value) => setDraft({ ...draft, output: value }) }),
					),
					h("div", { className: "dum_hint" }, t("prices.note")),
					h(
						"div",
						{ className: "dum_actions" },
						saved ? h("span", { className: "dum_hint" }, t("prices.saved")) : null,
						h("button", { type: "button", className: "dum_button", onClick: () => onReset() }, t("prices.reset")),
						h(
							"button",
							{
								type: "button",
								className: "dum_button",
								onClick: () => {
									onSave({
										input: parsed("input"),
										cacheRead: parsed("cacheRead"),
										cacheWrite: parsed("cacheWrite"),
										output: parsed("output"),
									});
									setSaved(true);
								},
							},
							t("prices.save"),
						),
					),
				),
				h("div", { className: "dum_footnote" }, t("panel.footnote")),
			);
		}
		/**
		 * Map a price field to its locale row key.
		 * @param priceField - price row field.
		 * @returns locale key suffix.
		 */
		function rowKeyFor(priceField) {
			if (priceField === "input") return "input";
			if (priceField === "cacheRead") return "cacheRead";
			if (priceField === "cacheWrite") return "cacheWrite";
			return "output";
		}
		//#endregion

		//#region lib/types/client/UsagePill.js
		/**
		 * The composer-dock entry: a pill that opens the detail panel.
		 * @param props - framework props, stores, and locale.
		 * @returns the pill, the panel, or nothing.
		 */
		function UsagePill({ useProjection, t, stores }) {
			const usage = useProjection("tokenUsage");
			const selection = useProjection("modelSelection");
			const prices = React.useSyncExternalStore(stores.prices.subscribe, stores.prices.getSnapshot, stores.prices.getSnapshot);
			const balance = React.useSyncExternalStore(stores.balance.subscribe, stores.balance.getSnapshot, stores.balance.getSnapshot);
			const [open, setOpen] = React.useState(false);
			const [pos, setPos] = React.useState(null);
			const triggerRef = React.useRef(null);
			const panelRef = React.useRef(null);
			const model = selection?.next?.model ?? selection?.lastUsed?.model;
			const provider = (selection?.next ?? selection?.lastUsed)?.provider;
			const price = priceFor(prices, model);
			const costs = usage === void 0 ? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 } : (() => {
				const per = {};
				for (const bucket of BUCKETS) per[bucket.price] = (Number(usage[bucket.usage]) || 0) / 1e6 * price[bucket.price];
				per.total = costOf(usage, price);
				return per;
			})();
			const hasUsage = usage !== void 0 && BUCKETS.some((bucket) => (Number(usage[bucket.usage]) || 0) > 0);
			const wallet = balance.status === "ready" ? balance.wallets[0] : void 0;
			// Place the panel above the pill, clamped to the viewport; flip below
			// when the dock sits near the top of a short window.
			React.useLayoutEffect(() => {
				if (!open) return void 0;
				const place = () => {
					const trigger = triggerRef.current;
					if (trigger === null) return;
					const rect = trigger.getBoundingClientRect();
					const width = Math.min(PANEL_WIDTH, window.innerWidth - 24);
					const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8));
					const above = rect.top - 12;
					const below = window.innerHeight - rect.bottom - 12;
					if (above >= 200 || above >= below) setPos({ left, bottom: window.innerHeight - rect.top + 8, width, maxHeight: Math.max(160, above) });
					else setPos({ left, top: rect.bottom + 8, width, maxHeight: Math.max(160, below) });
				};
				place();
				window.addEventListener("resize", place);
				return () => window.removeEventListener("resize", place);
			}, [open]);
			// Dismiss on Escape and on any press outside the pill and panel.
			React.useEffect(() => {
				if (!open) return void 0;
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				const onPress = (event) => {
					const target = event.target;
					if (triggerRef.current?.contains(target) === true) return;
					if (panelRef.current?.contains(target) === true) return;
					setOpen(false);
				};
				document.addEventListener("keydown", onKey);
				document.addEventListener("mousedown", onPress);
				return () => {
					document.removeEventListener("keydown", onKey);
					document.removeEventListener("mousedown", onPress);
				};
			}, [open]);
			// Stay out of the dock until there is something to report: measured
			// usage, or a wallet the account service actually returned.
			if (!hasUsage && balance.status !== "ready") return null;
			const label = hasUsage ? formatCost(costs.total, prices.currency) : null;
			const walletText = wallet === void 0 ? null : formatWallet(wallet.balance, wallet.currency);
			const title = [hasUsage ? t("pill.cost", { amount: formatCost(costs.total, prices.currency) }) : null, walletText === null ? null : t("pill.balance", { amount: walletText })].filter((part) => part !== null).join(" \u00b7 ") || t("pill.unavailable");
			return h(
				"span",
				{ className: "dum_root" },
				h(
					"button",
					{
						type: "button",
						ref: triggerRef,
						className: "dum_trigger",
						"aria-haspopup": "dialog",
						"aria-expanded": open,
						title,
						onClick: () => setOpen(!open),
					},
					h(UsageIcon, null),
					label,
					walletText === null ? null : h("span", { className: "dum_sep", "aria-hidden": true }, "\u00b7"),
					walletText,
				),
				open && pos !== null
					? ReactDOM.createPortal(
							h(Panel, {
								usage,
								model,
								provider,
								prices,
								price,
								costs,
								balance,
								style: { left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight },
								panelRef,
								t,
								onClose: () => setOpen(false),
								onRefresh: () => {
									stores.balance.refresh();
								},
								onSave: (next) => stores.prices.setModelPrice(model ?? FALLBACK_MODEL_KEY, next),
								onReset: () => stores.prices.resetModel(model ?? FALLBACK_MODEL_KEY),
								onCurrency: (code) => stores.prices.setCurrency(code),
							}),
							document.body,
						)
					: null,
			);
		}
		/**
		 * Contain any render failure to this slot entry instead of the whole dock.
		 */
		class Guard extends React.Component {
			constructor(props) {
				super(props);
				this.state = { failed: false };
			}
			static getDerivedStateFromError() {
				return { failed: true };
			}
			componentDidCatch(error) {
				try {
					console.warn("[dsh-usage-monitor] dock entry crashed", error);
				} catch (_error) {
					/* logging must never rethrow */
				}
			}
			render() {
				return this.state.failed ? null : this.props.children;
			}
		}
		/**
		 * Error-boundary wrapper around the dock entry.
		 * @param props - the entry's props.
		 * @returns the guarded entry.
		 */
		function GuardedUsagePill(props) {
			return h(Guard, null, h(UsagePill, props));
		}
		//#endregion

		//#region lib/types/client/index.js
		/** Services used by the browser half. */
		const inject = ["slots", "locale"];
		/**
		 * Register the dock entry while the conversation composer is composed.
		 * @param ctx - browser plugin context.
		 */
		function apply(ctx) {
			installStyles();
			ctx.effect(() => ctx.locale.register(NS, { en, zh }), "dsh-usage-monitor: dictionaries");
			const stores = { prices: createPriceStore(), balance: createBalanceStore(ctx) };
			ctx.slots.inject("conversation.composer.dock", () =>
				ctx.slots.register(
					{
						name: "conversation.composer.dock",
						id: "dsh-usage-monitor",
						order: 20,
						locale: NS,
						inject: () => ({ stores }),
					},
					GuardedUsagePill,
				),
			);
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
