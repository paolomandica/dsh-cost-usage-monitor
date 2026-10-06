/**
 * Exercises the Host half's balance route without a network or a Harness:
 * `index.js` is imported as a plain module, `webServer` and `credentials` are
 * doubles, and `fetch` is stubbed. That the import alone succeeds is the point:
 * the Host half must resolve no `@deepseek-ai/*` package, because a plugin
 * loaded from a `link:` path is resolved against its own directory, where no
 * harness package is installed.
 *
 * Run: node test/host.test.mjs
 */
import assert from 'node:assert/strict'
import { BALANCE_PATH, apply, inject, name } from '../index.js'

// ------------------------------------------------------------------- doubles

/** One recorded provider request. */
let providerCalls = []
/** The reply the stubbed provider returns for the next call. */
let providerReply = () => ({ status: 200, text: JSON.stringify({ is_available: true, balance_infos: [] }) })

globalThis.fetch = async (url, options) => {
  providerCalls.push({ url, options })
  const { status, text } = providerReply()
  return { status, ok: status >= 200 && status < 300, text: async () => text }
}

function makeResponse() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(text) {
      this.body = text
    },
  }
}

/** Register the route the way the Loader would, and hand back its handler. */
function mount(ctx) {
  let route
  const disposers = []
  ctx.effect = (callback) => {
    disposers.push(callback())
  }
  ctx.webServer = {
    register: (next) => {
      route = next
      return () => {
        route = undefined
      }
    },
  }
  apply(ctx)
  assert.ok(route, 'apply must register one route')
  assert.equal(route.kind, 'exact')
  assert.equal(route.path, BALANCE_PATH)
  return { route, disposers }
}

async function call(handler, method = 'GET') {
  const res = makeResponse()
  await handler({ method }, res)
  return { status: res.status, body: JSON.parse(res.body) }
}

// ------------------------------------------------------------------ identity

assert.equal(name, 'dsh-usage-monitor', 'the Host plugin id must equal the package name')
assert.deepEqual(inject, ['webServer'], 'the route needs the HTTP carrier')

// --- a configured credential reaches the documented endpoint ----------------
delete process.env.DEEPSEEK_API_KEY
let resolved = 0
const { route } = mount({
  get: (key) => (key === 'credentials' ? { resolve: async () => {
    resolved += 1
    return { value: 'sk-test-key', source: 'store' }
  } } : undefined),
})

providerReply = () => ({
  status: 200,
  text: JSON.stringify({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: '42.50', granted_balance: '5.00', topped_up_balance: '37.50' }],
  }),
})
let result = await call(route.handler)
assert.equal(result.status, 200)
assert.equal(result.body.ok, true)
assert.equal(result.body.isAvailable, true)
assert.deepEqual(result.body.wallets, [{ currency: 'CNY', totalBalance: '42.50', grantedBalance: '5.00', toppedUpBalance: '37.50' }])
assert.equal(providerCalls[0].url, 'https://api.deepseek.com/user/balance', 'the route must call the documented endpoint')
assert.equal(providerCalls[0].options.headers.authorization, 'Bearer sk-test-key', 'the key authenticates the provider call')
assert.equal(resolved, 1, 'the credential is resolved per request, not cached')

// --- a rejected credential is surfaced as 401 -------------------------------
providerReply = () => ({ status: 401, text: '{"error":"unauthorized"}' })
result = await call(route.handler)
assert.equal(result.status, 401)
assert.equal(result.body.error.code, 'unauthorized')

// --- a provider fault is surfaced as 502 ------------------------------------
providerReply = () => ({ status: 500, text: 'boom' })
result = await call(route.handler)
assert.equal(result.status, 502)
assert.equal(result.body.error.code, 'provider')

// --- a non-JSON provider body is surfaced as 502 ----------------------------
providerReply = () => ({ status: 200, text: '<html>nope</html>' })
result = await call(route.handler)
assert.equal(result.status, 502)
assert.equal(result.body.error.code, 'malformed')

// --- a provider that cannot be reached is surfaced, never hung --------------
providerReply = () => {
  throw new Error('getaddrinfo ENOTFOUND')
}
result = await call(route.handler)
assert.equal(result.status, 502)
assert.equal(result.body.error.code, 'network')

// --- no credential anywhere is surfaced as 503 ------------------------------
const bare = mount({ get: () => undefined })
providerReply = () => ({ status: 200, text: '{}' })
result = await call(bare.route.handler)
assert.equal(result.status, 503)
assert.equal(result.body.error.code, 'no-credential')

// --- the environment is the fallback credential source ----------------------
process.env.DEEPSEEK_API_KEY = 'sk-from-environment'
providerReply = () => ({ status: 200, text: JSON.stringify({ is_available: false, balance_infos: [] }) })
result = await call(bare.route.handler)
assert.equal(result.status, 200)
assert.equal(result.body.isAvailable, false)
assert.equal(providerCalls.at(-1).options.headers.authorization, 'Bearer sk-from-environment')
delete process.env.DEEPSEEK_API_KEY

// --- the route answers GET and HEAD, and refuses anything else -------------
result = await call(bare.route.handler, 'POST')
assert.equal(result.status, 405)
assert.equal(result.body.error.code, 'method')

console.log('ok — Host balance route: credential, provider faults, and method handling')
