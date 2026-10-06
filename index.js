/**
 * dsh-cost-usage-monitor — Host half.
 *
 * The browser half cannot read the account balance by itself: the DeepSeek API
 * key belongs to the Host, `api.deepseek.com` serves no CORS headers, and the
 * balance is not part of any session projection. So the Host half resolves the
 * credential and answers one loopback HTTP route from the documented endpoint:
 *
 *   GET /usage-monitor/balance
 *     200 { ok: true, isAvailable, fetchedAt, wallets: [{ currency,
 *           totalBalance, grantedBalance, toppedUpBalance }] }
 *     4xx/5xx { ok: false, error: { code, message } }
 *
 * Documented source: https://api-docs.deepseek.com/api/get-user-balance
 *
 * The key never leaves the Host, and the response carries only what the account
 * page shows. The route is served by the same loopback listener as the rest of
 * the Web GUI; see AGENTS.md for the contract and for how to refresh prices.
 *
 * @module dsh-cost-usage-monitor
 */

/** Cordis plugin name — also the browser module id registered by ./client. */
export const name = 'dsh-cost-usage-monitor'

/** The Web bundle owns the HTTP carrier this route rides on. */
export const inject = ['webServer']

/** The single route the browser half reads. */
export const BALANCE_PATH = '/usage-monitor/balance'

/** Documented balance endpoint, in the OpenAI-compatible API surface. */
const BALANCE_URL = 'https://api.deepseek.com/user/balance'

/** Credential the request authenticates with; a reference, never a value. */
const API_KEY_REF = 'DEEPSEEK_API_KEY'

/** Provider round-trip budget, so the panel never waits forever. */
const TIMEOUT_MS = 10000

/**
 * Write one JSON response, uncached.
 * @param res - the response owning this request.
 * @param status - HTTP status code.
 * @param body - JSON-serializable payload.
 */
function sendJson(res, status, body) {
	const text = JSON.stringify(body)
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
		'content-length': Buffer.byteLength(text),
	})
	res.end(text)
}

/**
 * Resolve the DeepSeek API key for this request.
 *
 * Read per operation rather than cached, so a rotated credential reaches the
 * next call without a restart. Falls back to the process environment, which is
 * where an unmanaged key usually lives.
 *
 * @param ctx - Host plugin context.
 * @returns the key, or undefined when none is configured.
 */
async function resolveApiKey(ctx) {
	let credentials
	try {
		credentials = ctx.get('credentials')
	} catch (_error) {
		/* a composition without the credential service falls through to the environment */
	}
	if (credentials !== void 0 && typeof credentials.resolve === 'function') {
		try {
			const hit = await credentials.resolve(API_KEY_REF)
			const value = typeof hit === 'string' ? hit : hit?.value
			if (typeof value === 'string' && value !== '') return value
		} catch (_error) {
			/* an unconfigured or unreachable provider falls through to the environment */
		}
	}
	const fromEnvironment = process.env[API_KEY_REF]
	return typeof fromEnvironment === 'string' && fromEnvironment !== '' ? fromEnvironment : void 0
}

/**
 * Shape one provider payload into the browser half's contract.
 * @param payload - parsed `GET /user/balance` body.
 * @param fetchedAt - epoch milliseconds the response arrived.
 * @returns the success body.
 */
function shapeBalance(payload, fetchedAt) {
	const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : []
	return {
		ok: true,
		isAvailable: payload?.is_available === true,
		fetchedAt,
		wallets: infos.map((info) => ({
			currency: typeof info?.currency === 'string' ? info.currency : '',
			totalBalance: String(info?.total_balance ?? ''),
			grantedBalance: String(info?.granted_balance ?? ''),
			toppedUpBalance: String(info?.topped_up_balance ?? ''),
		})),
	}
}

/**
 * Ask the provider for the account balance.
 * @param apiKey - resolved credential value.
 * @returns an HTTP status and JSON body for the browser half.
 */
async function fetchBalance(apiKey) {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
	try {
		const response = await fetch(BALANCE_URL, {
			method: 'GET',
			headers: { accept: 'application/json', authorization: 'Bearer ' + apiKey },
			signal: controller.signal,
		})
		const text = await response.text()
		if (response.status === 401 || response.status === 403) {
			return { status: 401, body: { ok: false, error: { code: 'unauthorized', message: 'DeepSeek rejected the ' + API_KEY_REF + ' credential (' + response.status + ').' } } }
		}
		if (!response.ok) {
			return { status: 502, body: { ok: false, error: { code: 'provider', message: 'The balance request failed with ' + response.status + '.' } } }
		}
		let payload
		try {
			payload = JSON.parse(text)
		} catch (_error) {
			return { status: 502, body: { ok: false, error: { code: 'malformed', message: 'The balance response was not JSON.' } } }
		}
		return { status: 200, body: shapeBalance(payload, Date.now()) }
	} catch (error) {
		const aborted = error instanceof Error && error.name === 'AbortError'
		return {
			status: aborted ? 504 : 502,
			body: {
				ok: false,
				error: aborted
					? { code: 'timeout', message: 'The balance request did not answer within ' + TIMEOUT_MS / 1000 + ' s.' }
					: { code: 'network', message: 'The balance request could not reach ' + BALANCE_URL + '.' },
			},
		}
	} finally {
		clearTimeout(timer)
	}
}

/**
 * Activate the Host half.
 *
 * Registers the one balance route and nothing else: no service, tool,
 * projection, or model-facing surface. Unloading it withdraws the route.
 *
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'exact',
				path: BALANCE_PATH,
				handler: async (req, res) => {
					if (req.method !== 'GET' && req.method !== 'HEAD') {
						sendJson(res, 405, { ok: false, error: { code: 'method', message: 'Use GET ' + BALANCE_PATH + '.' } })
						return
					}
					const apiKey = await resolveApiKey(ctx)
					if (apiKey === void 0) {
						sendJson(res, 503, { ok: false, error: { code: 'no-credential', message: 'No ' + API_KEY_REF + ' credential is configured for this profile.' } })
						return
					}
					const result = await fetchBalance(apiKey)
					sendJson(res, result.status, result.body)
				},
			}),
		'dsh-cost-usage-monitor: balance route',
	)
}
