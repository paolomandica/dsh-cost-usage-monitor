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
    if (name === 'remote') return ctx.__remote
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
  __remote: undefined,
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

assert.equal(loaded.id, 'dsh-usage-monitor', 'the module id must equal the package name')

const plugin = loaded.factory(requireDouble)
assert.equal(typeof plugin.apply, 'function', 'the factory must export apply')
assert.deepEqual(plugin.inject, ['slots', 'locale'], 'the factory must declare its services')

plugin.apply(ctx)
assert.ok(registration, 'apply must register exactly one slot entry')
assert.equal(registration.options.name, 'conversation.composer.dock')
assert.equal(registration.options.id, 'dsh-usage-monitor')
assert.equal(registration.options.locale, 'usageMonitor')

const { stores } = registration.options.inject()

// --- the account Remote the widget reads from -------------------------------
let metadataSeen
ctx.__remote = {
  account: {
    getBalance: async (metadata) => {
      metadataSeen = metadata
      return { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '42.50' }], bonusWallets: [{ currency: 'CNY', balance: '5.00' }] } }
    },
  },
}
await stores.balance.refresh()
assert.equal(stores.balance.getSnapshot().status, 'ready')
assert.deepEqual(metadataSeen.locale, 'en-US')
assert.equal(metadataSeen.timezoneOffsetSeconds % 60, 0, 'the metadata offset is whole seconds')

// --- render the pill --------------------------------------------------------
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
// deepseek-flash defaults: 1M input * 0.28 + 2M cacheRead * 0.028 + 0.1M output * 0.42 = 0.378
assert.ok(html.includes('$0.378'), `the pill must show the session cost, got: ${html}`)

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
assert.ok(html.includes('$0.378'), 'the panel total must match the pill')
assert.ok(html.includes('section.prices'), 'the panel must render the price editor')

// --- a signed-out account still renders the cost side ----------------------
ctx.__remote = { account: { getBalance: async () => ({ ok: true, value: null }) } }
await stores.balance.refresh()
assert.equal(stores.balance.getSnapshot().status, 'signed-out')
tree = renderFunction(registration.component, props)
assert.ok(serialize(tree).includes('$0.378'), 'the cost survives a signed-out account')

// --- no account namespace at all -------------------------------------------
ctx.__remote = undefined
await stores.balance.refresh()
assert.equal(stores.balance.getSnapshot().status, 'unavailable')

// --- nothing measured and no wallet: the entry stays out of the dock -------
const quiet = renderFunction(registration.component, {
  ...props,
  useProjection: () => undefined,
})
serialize(quiet)
flushAll()
assert.equal(serialize(renderFunction(registration.component, { ...props, useProjection: () => undefined })), '', 'an empty session renders nothing')

// --- price overrides round-trip --------------------------------------------
stores.prices.setModelPrice('deepseek-flash', { input: 1, cacheRead: 0, cacheWrite: 0, output: 2 })
assert.deepEqual(stores.prices.getSnapshot().models['deepseek-flash'], { input: 1, cacheRead: 0, cacheWrite: 0, output: 2 })
assert.ok(storage.get('dsh-usage-monitor/prices/v1').includes('"input":1'), 'price overrides persist to localStorage')
stores.prices.resetModel('deepseek-flash')
assert.equal(stores.prices.getSnapshot().models['deepseek-flash'].input, 0.28)

console.log('ok — dock entry, panel, wallet, and price table all behave')
