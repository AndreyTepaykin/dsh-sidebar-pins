import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * The two React members the bundle uses. Tests drive slot components by calling
 * them directly and inspecting the returned element tree.
 */
const reactStub = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useSyncExternalStore(subscribe, getSnapshot) {
    return getSnapshot()
  }
}

/**
 * Execute the browser bundle the way the shell does: `window.__ModuleLoader__`
 * captures one registration, then the factory runs with the shell's `require`.
 * @param sandbox - extra globals the half needs (`document`, `navigator`, ...).
 * @returns the captured registration, the factory's exports, and the stub.
 */
function loadBundle(sandbox = {}) {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let registration = null
  // Mutate the caller's window object rather than copying it, so globals the
  // bundle publishes (`window.__dshSidebarPins`) stay observable by tests.
  const window = sandbox.window ?? {}
  window.__ModuleLoader__ = {
    load(candidate) {
      registration = candidate
    }
  }
  const context = { ...sandbox, window, console }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(source, context, { filename: 'lib/client.js' })
  if (registration === null) throw new Error('bundle did not call window.__ModuleLoader__.load')
  const exports = registration.factory((specifier) => {
    if (specifier === 'react') return reactStub
    throw new Error(`unexpected require("${specifier}")`)
  })
  return { registration, exports, reactStub }
}

export { loadBundle, reactStub }
