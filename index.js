/**
 * dsh-usage-monitor — Host half.
 *
 * The whole feature is a browser widget: session token usage arrives over the
 * existing `tokenUsage` / `modelSelection` session projections, and the account
 * balance arrives over the existing `account` Remote namespace (owned by
 * `@deepseek-ai/dsh-api-account-controller`). Nothing here touches the session
 * log, the model request, or the prompt, so the Host side only needs to exist
 * as a resolvable Loader entry for the bundle's client module.
 *
 * @module dsh-usage-monitor
 */

/** Cordis plugin name — also the browser module id registered by ./client. */
export const name = 'dsh-usage-monitor'

/**
 * Activate the Host half.
 *
 * Intentionally empty: this plugin registers no service, tool, projection, or
 * event listener. Unloading it removes only the browser entries it owns.
 */
export function apply() {}
