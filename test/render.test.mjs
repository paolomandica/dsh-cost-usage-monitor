/**
 * Renders the browser half under a minimal React double to prove the dock entry
 * and its panel mount without throwing, and that they surface the values the
 * widget promises: session cost from `tokenUsage`, and the wallet from the
 * account Remote.
 *
 * The DSH Client runtime ships React inside the web build, so this repository
 * cannot import the real React; the double below implements only the hook
 * surface `client.js` uses.
 *
 * Run: node test/render.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

// ---------------------------------------------------------------- React double

let rendering = null

function createElement(type, props, ...children) {
  return { type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) }
}

const Fragment = Symbol('Fragment')

function useState(initial) {
  const instance = rendering
  const cell = instance.hooks[instance.cursor] ?? (instance.hooks[instance.cursor] = { value: typeof initial === 'function' ? initial() : initial })
  instance.cursor++
  cell.set = cell.set ?? ((next) => {
    cell.value = typeof next === 'function' ? next(cell.value) : next
    instance.dirty = true
  })
  return [cell.value, cell.set]
}

function useRef(initial) {
  const instance = rendering
  const cell = instance.hooks[instance.cursor] ?? (instance.hooks[instance.cursor] = { value: { current: initial } })
  instance.cursor++
  return cell.value
}

function useEffect(effect) {
  const instance = rendering
  instance.cursor++
  instance.pending.push(effect)
}

function useSyncExternalStore(_subscribe, getSnapshot, getServerSnapshot) {
  rendering.cursor++
  return (getServerSnapshot ?? getSnapshot)()
}

class Component {
  constructor(props) {
    this.props = props
    this.state = {}
  }
  setState(next) {
    this.state = { ...this.state, ...(typeof next === 'function' ? next(this.state) : next) }
    this.__dirty = true
  }
}

const React = {
  createElement,
  Fragment,
  Component,
  useState,
  useRef,
  useEffect,
  useLayoutEffect: useEffect,
  useSyncExternalStore,
  memo: (fn) => fn,
}

/** One hook cell per component function, as React keeps one per render position. */
const instances = new Map()

/** Render a component function, queuing its effects for the next flush. */
function renderFunction(fn, props) {
  let instance = instances.get(fn)
  if (instance === undefined) {
    instance = { hooks: [], cursor: 0, dirty: false, pending: [], fn, props }
    instances.set(fn, instance)
  }
  instance.fn = fn
  instance.props = props
  const previous = rendering
  rendering = instance
  try {
    for (let pass = 0; pass < 12; pass += 1) {
      instance.cursor = 0
      instance.dirty = false
      instance.tree = fn(props)
      if (!instance.dirty) break
    }
  } finally {
    rendering = previous
  }
  return instance.tree
}

/**
 * Run queued effects, then re-render whatever they invalidated. Call after a
 * serialize pass so element refs are attached, as React commits before effects.
 */
function flushAll() {
  for (const instance of instances.values()) {
    const effects = instance.pending
    instance.pending = []
    for (const effect of effects) effect()
  }
  for (const instance of instances.values()) {
    if (instance.dirty) renderFunction(instance.fn, instance.props)
  }
}

// ------------------------------------------------------------- tiny serializer

function serialize(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(serialize).join('')
  if (node.type === Fragment) return node.children.map(serialize).join('')
  if (typeof node.type === 'function' && node.type.prototype instanceof Component) {
    const instance = new node.type({ ...node.props, children: node.children })
    let tree = instance.render()
    if (instance.__dirty) tree = instance.render()
    return serialize(tree)
  }
  if (typeof node.type === 'function') return serialize(renderFunction(node.type, { ...node.props, children: node.children }))
  const body = node.children.map(serialize).join('')
  if (node.props?.ref !== undefined && typeof node.props.ref === 'object') {
    node.props.ref.current = {
      getBoundingClientRect: () => ({ left: 400, right: 460, top: 600, bottom: 620, width: 60, height: 20 }),
      contains: () => true,
    }
  }
  const cls = node.props?.className === undefined ? '' : ` class="${node.props.className}"`
  return `<${node.type}${cls}>${body}</${node.type}>`
}

function find(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, predicate)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (predicate(node)) return node
  if (typeof node.type === 'function' && node.type.prototype instanceof Component) {
    const instance = new node.type({ ...node.props, children: node.children })
    return find(instance.render(), predicate)
  }
  if (typeof node.type === 'function') return find(renderFunction(node.type, { ...node.props, children: node.children }), predicate)
  return find(node.children, predicate)
}

// ------------------------------------------------------------------ DOM doubles

function makeDocument() {
  const listeners = new Map()
  return {
    head: { appendChild() {} },
    body: {},
    querySelector: () => null,
    createElement: () => ({ dataset: {}, style: {} }),
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  }
}

function makeWindow() {
  const listeners = new Map()
  return {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    localStorage: undefined,
  }
}

// --------------------------------------------------------------------- harness

const documentDouble = makeDocument()
const windowDouble = makeWindow()
const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}

let registration
const registered = []
const ctx = {
  effect: (fn) => {
    const dispose = fn()
    registered.push(dispose)
  },
  get: (name) => {
    if (name === 'locale') return ctx.locale
    return undefined
  },
  locale: {
    register: () => () => {},
    getSnapshot: () => ({ active: 'en-US' }),
  },
  slots: {
    inject: (_owner, callback) => {
      callback()
    },
    register: (options, component) => {
      registration = { options, component }
      return () => {}
    },
  },
}

let loaded
windowDouble.__ModuleLoader__ = {
  load: (entry) => {
    loaded = entry
  },
}

const requireDouble = (specifier) => {
  if (specifier === 'react') return React
  if (specifier === 'react-dom') return { createPortal: (element) => element }
  throw new Error(`unexpected require: ${specifier}`)
}

// `client.js` is a browser script, not a module: evaluate it with the browser
// globals the module loader would have supplied.
new Function('window', 'document', 'require', source)(windowDouble, documentDouble, requireDouble)

assert.equal(loaded.id, 'dsh-cost-usage-monitor', 'the module id must equal the package name')

const plugin = loaded.factory(requireDouble)
assert.equal(typeof plugin.apply, 'function', 'the factory must export apply')
assert.deepEqual(plugin.inject, ['slots', 'locale'], 'the factory must declare its services')

plugin.apply(ctx)
assert.ok(registration, 'apply must register exactly one slot entry')
assert.equal(registration.options.name, 'conversation.composer.dock')
assert.equal(registration.options.id, 'dsh-cost-usage-monitor')
assert.equal(registration.options.locale, 'usageMonitor')

const { stores } = registration.options.inject()

// --- the balance route the Host half serves ---------------------------------
// The browser never holds the API key: it reads the Host's own route, so the
// double stands in for that route rather than for an account Remote.
const routeCalls = []
let routeReply = () => ({
  status: 200,
  body: {
    ok: true,
    isAvailable: true,
    fetchedAt: 1_700_000_000_000,
    wallets: [{ currency: 'CNY', totalBalance: '42.50', grantedBalance: '5.00', toppedUpBalance: '37.50' }],
  },
})
globalThis.fetch = async (url, options) => {
  routeCalls.push({ url, options })
  const { status, body } = routeReply()
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }
}

await stores.balance.refresh()
assert.equal(stores.balance.getSnapshot().status, 'ready')
assert.equal(routeCalls[0].url, '/usage-monitor/balance', 'the store reads the Host route')
assert.deepEqual(stores.balance.getSnapshot().wallets, [{ currency: 'CNY', balance: '42.50' }])
assert.deepEqual(stores.balance.getSnapshot().bonusWallets, [{ currency: 'CNY', balance: '5.00' }])

// A rejected credential is reported, not retried forever.
routeReply = () => ({ status: 401, body: { ok: false, error: { code: 'unauthorized', message: 'DeepSeek rejected the DEEPSEEK_API_KEY credential (401).' } } })
await stores.balance.refresh()
assert.equal(stores.balance.getSnapshot().status, 'failed')
assert.match(stores.balance.getSnapshot().error, /rejected the DEEPSEEK_API_KEY/)

// A missing route is reported as unreachable rather than left loading.
routeReply = () => {
  throw new Error('connection refused')
}
await stores.balance.refresh()
assert.equal(stores.balance.getSnapshot().status, 'unavailable')
assert.match(stores.balance.getSnapshot().error, /not reachable/)

routeReply = () => ({
  status: 200,
  body: {
    ok: true,
    isAvailable: true,
    fetchedAt: 1_700_000_000_000,
    wallets: [{ currency: 'CNY', totalBalance: '42.50', grantedBalance: '5.00', toppedUpBalance: '37.50' }],
  },
})
await stores.balance.refresh()
assert.equal(stores.balance.getSnapshot().status, 'ready')

// --- render the pill --------------------------------------------------------
// A settable clock keeps the peak/off-peak tariff deterministic: the widget
// reads `Date.now()` on every render to pick the tariff factor.
const RealDate = Date
let frozenAt = new RealDate('2026-03-11T12:00:00Z').getTime() // Wednesday 12:00 UTC, off-peak
class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(frozenAt)
    else super(...args)
  }
  static now() {
    return frozenAt
  }
}
globalThis.Date = FrozenDate

const usage = { uncachedInputTokens: 1_000_000, cacheReadTokens: 2_000_000, cacheWriteTokens: 0, outputTokens: 100_000 }
const props = {
  useProjection: (key) => {
    if (key === 'tokenUsage') return usage
    if (key === 'modelSelection') return { lastUsed: { provider: 'deepseek-account', model: 'deepseek-flash' }, next: null }
    return undefined
  },
  t: (key, params) => {
    if (params === undefined) return key
    return Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), key)
  },
  stores,
}

let tree = renderFunction(registration.component, props)
let html = serialize(tree)
flushAll()
tree = renderFunction(registration.component, props)
html = serialize(tree)
assert.ok(html.includes('¥42.50'), `the pill must show the wallet balance, got: ${html}`)
// deepseek-flash off-peak defaults: 1M input * 0.15 + 2M cacheRead * 0.003 + 0.1M output * 0.6 = 0.216
assert.ok(html.includes('$0.216'), `the pill must show the session cost, got: ${html}`)

// --- open the panel ---------------------------------------------------------
const trigger = find(tree, (node) => node.type === 'button')
assert.ok(trigger, 'the pill must expose a button')
trigger.props.onClick()
tree = renderFunction(registration.component, props)
serialize(tree)
flushAll()
tree = renderFunction(registration.component, props)
html = serialize(tree)
assert.ok(html.includes('section.cost'), 'the panel must render the cost section')
assert.ok(html.includes('row.cacheRead'), 'the panel must render the token rows')
assert.ok(html.includes('42.50'), 'the panel must render the wallet')
assert.ok(html.includes('5.00'), 'the panel must render the bonus wallet')
assert.ok(html.includes('deepseek-flash'), 'the panel must name the priced model')
assert.ok(html.includes('$0.216'), 'the panel total must match the pill')
assert.ok(html.includes('section.prices'), 'the panel must render the price editor')
assert.ok(html.includes('row.peakMultiplier'), 'the panel must render the peak multiplier field')
assert.ok(html.includes('prices.tierOffPeak'), 'the panel must name the tariff in force')

// --- the peak tariff doubles the estimate ----------------------------------
frozenAt = new RealDate('2026-03-11T02:00:00Z').getTime() // Wednesday 02:00 UTC, peak
assert.equal(stores.prices.getSnapshot().peakMultiplier, 2, 'peak is twice off-peak by default')
tree = renderFunction(registration.component, props)
html = serialize(tree)
assert.ok(html.includes('$0.432'), `the peak tariff must double the cost, got: ${html}`)
assert.ok(html.includes('prices.tierPeak'), 'the panel must name the peak tier')
// Saturday 02:00 UTC is inside a peak window but on a weekend, so it is off-peak.
frozenAt = new RealDate('2026-03-14T02:00:00Z').getTime()
html = serialize(renderFunction(registration.component, props))
assert.ok(html.includes('$0.216'), `weekends must stay off-peak, got: ${html}`)
frozenAt = new RealDate('2026-03-11T12:00:00Z').getTime()

// --- a failing balance route still renders the cost side --------------------
routeReply = () => ({ status: 503, body: { ok: false, error: { code: 'no-credential', message: 'No DEEPSEEK_API_KEY credential is configured for this profile.' } } })
await stores.balance.refresh()
assert.equal(stores.balance.getSnapshot().status, 'failed')
tree = renderFunction(registration.component, props)
html = serialize(tree)
assert.ok(html.includes('$0.216'), 'the cost survives an unreadable balance')
assert.ok(html.includes('DEEPSEEK_API_KEY'), `the panel must say why the balance failed, got: ${html}`)

// --- nothing measured and no wallet: the entry stays out of the dock -------
routeReply = () => {
  throw new Error('connection refused')
}
await stores.balance.refresh()
const quiet = renderFunction(registration.component, {
  ...props,
  useProjection: () => undefined,
})
serialize(quiet)
flushAll()
assert.equal(serialize(renderFunction(registration.component, { ...props, useProjection: () => undefined })), '', 'an empty session renders nothing')

// --- the editor's save and reset wiring round-trip -------------------------
tree = renderFunction(registration.component, props)
const editor = find(tree, (node) => typeof node.props?.onSave === 'function')
assert.ok(editor, 'the panel must expose save and reset handlers')
editor.props.onSave({ input: 1, cacheRead: 0, cacheWrite: 0, output: 2, peakMultiplier: 3 })
assert.deepEqual(stores.prices.getSnapshot().models['deepseek-flash'], { input: 1, cacheRead: 0, cacheWrite: 0, output: 2 }, 'saving writes only the price row')
assert.equal(stores.prices.getSnapshot().peakMultiplier, 3, 'saving carries the peak multiplier')
assert.ok(storage.get('dsh-cost-usage-monitor/prices/v1').includes('"input":1'), 'price overrides persist to localStorage')
editor.props.onReset()
assert.equal(stores.prices.getSnapshot().models['deepseek-flash'].input, 0.15, 'reset restores the shipped default')
assert.equal(stores.prices.getSnapshot().peakMultiplier, 2, 'reset restores the peak multiplier')

// --- a non-positive multiplier falls back to the default -------------------
stores.prices.setPeakMultiplier(0)
assert.equal(stores.prices.getSnapshot().peakMultiplier, 2)

console.log('ok — dock entry, panel, wallet, and price table all behave')
