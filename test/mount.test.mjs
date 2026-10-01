import test from 'node:test'
import assert from 'node:assert/strict'
import { loadBundle } from './load-bundle.mjs'
import { FakeElement, fakeDocument } from './fake-dom.mjs'

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value))
    },
    removeItem: (key) => {
      map.delete(key)
    },
    snapshot: () => Object.fromEntries(map)
  }
}

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback
  }
  observe() {}
  disconnect() {}
}

/** Records every observe() target so the tests can assert what is watched. */
class TrackingObserver extends FakeMutationObserver {
  constructor(callback) {
    super(callback)
    this.targets = []
    observers.push(this)
  }
  observe(target, options) {
    this.targets.push({ target, options })
  }
}

const observers = []

/** Bundle values are created in another realm; compare structural copies. */
const plain = (value) => JSON.parse(JSON.stringify(value))

/** One sidebar session row: a title span, plus an optional React fiber stub. */
function sessionRow(id, options = {}) {
  const row = new FakeElement('div')
  row.attrs.role = 'treeitem'
  const title = new FakeElement('span')
  title.textContent = options.title ?? id
  row.appendChild(title)
  if (options.fiber === true) {
    row['__reactFiber$test'] = {
      memoizedProps: { anchor: true },
      return: { memoizedProps: { node: { id } }, return: null }
    }
  }
  return row
}

function makeCtx(options = {}) {
  const own = options.pinned ?? ['a', 'b']
  const byId = options.byId ?? { a: { displayTitle: 'Alpha' }, b: { displayTitle: 'Beta' } }
  const legacy = options.legacyPinned
  const state = {
    setCalls: [],
    opened: [],
    slotRegistrations: [],
    components: [],
    cleanup: null,
    scopeListeners: [],
    sessionListeners: []
  }

  const namespaceOf = (namespace) => {
    if (namespace === 'sidebar-pins') {
      return {
        status: 'ready',
        mode: 'host',
        value: { pinned: own },
        user: options.ownUser
      }
    }
    if (namespace === 'session-pin' && legacy !== undefined) {
      return { status: 'ready', mode: 'host', value: { pinned: legacy }, user: undefined }
    }
    return { status: 'unavailable', mode: 'host', value: undefined, user: undefined }
  }

  const ctx = {
    logger: { warn() {}, info() {} },
    settingsScope: {
      bind: (spec) => {
        const namespace = spec.namespace
        return {
          getSnapshot: () => ({ ...namespaceOf(namespace), revision: 1, writable: true, base: undefined }),
          subscribe: (listener) => {
            state.scopeListeners.push(listener)
            return () => {}
          },
          set: (field, value) => {
            state.setCalls.push([namespace, field, value])
            return Promise.resolve()
          }
        }
      }
    },
    sessions: {
      list: {
        getSnapshot: () => ({ phase: 'ready', ids: Object.keys(byId), byId }),
        subscribe: (listener) => {
          state.sessionListeners.push(listener)
          return () => {}
        }
      },
      open: (id) => {
        state.opened.push(id)
      }
    },
    slots: {
      inject: (name, callback) => {
        const dispose = callback()
        state.slotRegistrations.push({ name, dispose })
        return () => dispose()
      },
      register: (options, component) => {
        state.components.push({ name: options.name, id: options.id, component })
        return () => {}
      }
    },
    effect: (callback) => {
      state.cleanup = callback()
      return () => {}
    }
  }
  return { ctx, state }
}

function mount(options = {}) {
  const document = options.document ?? fakeDocument()
  const storage = memoryStorage(options.storageSeed)
  // Only the observers of this mount matter to the calling test.
  observers.length = 0
  const globals = {
    localStorage: storage,
    setTimeout,
    clearTimeout
  }
  const { exports, reactStub } = loadBundle({
    document,
    navigator: { language: options.language ?? 'ru-RU' },
    MutationObserver: TrackingObserver,
    window: globals
  })
  const { ctx, state } = makeCtx(options)
  exports.apply(ctx)
  return { document, storage, state, exports, reactStub, observers, globals }
}

test('footerSeat records a candidate seat per level of the anchor chain', () => {
  const { exports } = loadBundle()
  const document = fakeDocument()
  const { root, foot, footerActions, entryWrapper, anchor, settings, column } = document.__fixture
  const seat = exports.__test.footerSeat(document)

  assert.equal(seat.anchor, anchor, 'the anchor is the only starting point')
  assert.equal(seat.levels[0].container, entryWrapper, 'level 0 is the slot entry wrapper')
  assert.equal(seat.levels[0].before, anchor)
  assert.equal(seat.levels[1].container, footerActions, 'level 1 is the footer actions block')
  assert.equal(seat.levels[1].before, entryWrapper)
  assert.equal(seat.levels[2].container, foot, 'level 2 is the footer block')
  assert.equal(seat.levels[2].before, footerActions)
  assert.equal(seat.levels[2].after, settings, 'and the block that follows it is the Settings block')
  assert.equal(exports.__test.scopeOf(seat), column, 'the scan scope is the outermost level')
  assert.equal(root.contains(anchor), true)
})

test('footerSeat needs no session row and reports nothing without the anchor', () => {
  const { exports } = loadBundle()
  const rowless = fakeDocument({ row: false })
  const seat = exports.__test.footerSeat(rowless)

  assert.equal(seat.levels[2].container, rowless.__fixture.foot, 'no session row is needed at all')
  assert.equal(exports.__test.footerSeat(fakeDocument({ anchor: false })), null, 'no anchor, no seat')
})

test('a row container is never used as a seat', () => {
  const { exports } = loadBundle()
  const document = fakeDocument()
  const { footerActions, entryWrapper, foot } = document.__fixture

  assert.equal(exports.__test.stacksVertically(document, footerActions), false, 'row: the pane would lie sideways')
  assert.equal(
    exports.__test.stacksVertically(document, entryWrapper),
    false,
    'an item of a row is as narrow as the row decides'
  )
  assert.equal(exports.__test.stacksVertically(document, foot), true, 'the footer block stacks')
})

test('apply seats the pane inside the footer block, above the Settings row', () => {
  const { document, state, globals } = mount()
  const { foot, footerActions, settings } = document.__fixture
  const block = document.querySelector('[data-dsh-sidebar-pins]')

  assert.equal(block.getAttribute('data-dsh-sidebar-pins'), '')
  assert.equal(block.parentElement, foot, 'the pane is a child of the footer block')
  assert.equal(block.nextElementSibling, footerActions, 'and sits immediately above the footer actions')
  assert.deepEqual(
    foot.children.map((child) =>
      child === block ? 'pane' : child === footerActions ? 'actions' : child === settings ? 'settings' : '?'
    ),
    ['pane', 'actions', 'settings'],
    'so it is above the Settings row'
  )
  assert.deepEqual(
    plain(globals.__dshSidebarPins.skipped),
    ['above the footer content (level 0)', 'above the footer content (level 1)'],
    'the two row-level seats were considered and skipped'
  )
  assert.equal(globals.__dshSidebarPins.seat, 2)
  assert.equal(block.getAttribute('data-collapsed'), '0')
  assert.equal(block.querySelector('.dsp-label').textContent, 'Закреплённые')
  assert.equal(block.querySelector('.dsp-count').textContent, '2')

  const list = block.querySelector('.dsp-list')
  assert.deepEqual(
    plain(list.children.map((row) => row.querySelector('.dsp-title').textContent)),
    ['Alpha', 'Beta']
  )

  // Row click opens the session; the × button unpins.
  block.querySelector('.dsp-list').click(list.children[0])
  assert.deepEqual(plain(state.opened), ['a'])

  const unpin = list.children[0].querySelector('.dsp-unpin')
  unpin.closest = (selector) => (selector === '.dsp-unpin' ? unpin : list.children[0])
  block.querySelector('.dsp-list').click(unpin)
  assert.deepEqual(plain(state.setCalls), [['sidebar-pins', 'pinned', ['b']]])
})

test('the anchor component carries the seat marker and no visual weight', () => {
  const { exports } = loadBundle()
  const Anchor = exports.__test.createAnchor()
  const element = Anchor({})
  assert.equal(element.type, 'span')
  assert.equal(element.props['data-dsh-sidebar-pins-anchor'], '')
  assert.equal(element.props['aria-hidden'], 'true')
})

test('the pane is a capped slice of the sidebar height with an internal scroll area', () => {
  const { document } = mount()
  const css = document.getElementById('dsh-sidebar-pins-style').textContent

  assert.match(css, /\[data-dsh-sidebar-pins\]\{flex:0 1 30vh;min-height:0;/)
  assert.match(css, /\[data-dsh-sidebar-pins\]\[data-collapsed='1'\]\{flex:0 0 auto;/)
  assert.match(css, /\.dsp-list\{flex:1 1 auto;min-height:0;overflow-y:auto;/)
  assert.match(css, /\[data-dsh-sidebar-pins-anchor\]\{display:none;\}/)
  assert.match(css, /\[data-dsh-sidebar-pins\]\[data-rail='1'\]\{flex:0 0 auto;/)
})

test('a stale position=top in localStorage no longer moves the pane', () => {
  const { document } = mount({ storageSeed: { 'dsh.sidebar-pins.position': 'top' } })
  const { foot, footerActions } = document.__fixture
  const block = document.querySelector('[data-dsh-sidebar-pins]')
  assert.equal(block.parentElement, foot)
  assert.equal(block.nextElementSibling, footerActions)
})

test('a rail sidebar keeps the pane to its header line, icon and count only', () => {
  const document = fakeDocument()
  // The rail is judged from the container the pane lives in.
  document.__fixture.foot.__rect = () => ({ top: 0, bottom: 800, width: 56, height: 800 })
  const { globals } = mount({ document })
  const block = document.querySelector('[data-dsh-sidebar-pins]')
  const head = block.querySelector('.dsp-head')

  assert.equal(block.getAttribute('data-rail'), '1')
  assert.equal(globals.__dshSidebarPins.rail, true)
  assert.equal(block.querySelector('.dsp-list').children.length, 0, 'no list in the rail')
  assert.equal(head.getAttribute('aria-expanded'), 'false')
  assert.equal(block.querySelector('.dsp-label').textContent, '', 'no words in the rail')
  assert.equal(block.querySelector('.dsp-count').textContent, '2', 'just the number')
  assert.notEqual(head.querySelector('.dsp-pin'), null, 'the pin icon stays')
  assert.equal(head.getAttribute('aria-label'), 'Закреплённые (2)', 'the accessible name keeps the words')
  assert.match(
    document.getElementById('dsh-sidebar-pins-style').textContent,
    /\[data-dsh-sidebar-pins\]\[data-rail='1'\] \.dsp-chev\{display:none;\}/
  )
})

test('a wide sidebar is not a rail', () => {
  const document = fakeDocument()
  document.__fixture.foot.__rect = () => ({ top: 0, bottom: 800, width: 280, height: 800 })
  const { globals } = mount({ document })
  assert.equal(globals.__dshSidebarPins.rail, false)
  const block = document.querySelector('[data-dsh-sidebar-pins]')
  assert.equal(block.getAttribute('data-rail'), '0')
  assert.equal(block.querySelector('.dsp-label').textContent, 'Закреплённые')
})

test('an unchanged pane is not rebuilt on the next pass', async () => {
  const { document, observers } = mount()
  const block = document.querySelector('[data-dsh-sidebar-pins]')
  const firstRow = block.querySelector('.dsp-list').children[0]

  observers[0].callback()
  await new Promise((resolve) => setTimeout(resolve, 160))

  const rows = block.querySelector('.dsp-list').children
  assert.equal(rows.length, 2)
  assert.equal(rows[0], firstRow, 'the same row node survives, so no mutation loop')
})

test('a second attach pass keeps exactly one pane, in the same seat', async () => {
  const { document, observers } = mount()
  const { foot, footerActions } = document.__fixture
  const first = document.querySelector('[data-dsh-sidebar-pins]')

  observers[0].callback()
  await new Promise((resolve) => setTimeout(resolve, 160))

  const panes = foot.querySelectorAll('[data-dsh-sidebar-pins]')
  assert.equal(panes.length, 1)
  assert.equal(panes[0], first)
  assert.equal(first.parentElement, foot)
  assert.equal(first.nextElementSibling, footerActions)
})

test('a footer that refuses the pane falls back above the whole footer block', () => {
  const document = fakeDocument()
  const { root, foot, footerActions } = document.__fixture
  const original = foot.insertBefore.bind(foot)
  foot.insertBefore = () => {
    throw new Error('boom')
  }

  const { globals } = mount({ document })
  const pane = document.querySelector('[data-dsh-sidebar-pins]')
  assert.notEqual(pane, null, 'the pane must survive a rejected seat')
  assert.equal(pane.parentElement, root, 'the second seat is the sidebar root')
  assert.equal(pane.nextElementSibling, foot, 'and it lands right above the footer block')
  assert.match(String(globals.__dshSidebarPins.notes.join(' | ')), /\(level 2\)" refused the pane/)
  foot.insertBefore = original
  assert.equal(footerActions.parentElement, foot)
})

test('a completely refusing sidebar still mounts the pane inside it', () => {
  const document = fakeDocument()
  const { root, foot } = document.__fixture
  root.insertBefore = () => {
    throw new Error('boom')
  }
  foot.insertBefore = () => {
    throw new Error('boom')
  }

  const { globals } = mount({ document })
  const pane = document.querySelector('[data-dsh-sidebar-pins]')
  assert.notEqual(pane, null, 'the pane is never lost')
  assert.equal(pane.parentElement, foot, 'the last resort stays inside the sidebar')
  assert.equal(foot.lastElementChild, pane)
  assert.equal(globals.__dshSidebarPins.seat, 4, 'the last seat of the list')
  const notes = String(globals.__dshSidebarPins.notes.join(' | '))
  assert.match(notes, /\(level 2\)" refused the pane/)
  assert.match(notes, /\(level 3\)" refused the pane/)
})

test('seatIsSane keeps the pane above the Settings row', () => {
  const { exports } = loadBundle()
  const { seatIsSane } = exports.__test
  const settings = { top: 600, bottom: 650, height: 50 }

  assert.equal(seatIsSane({ top: 550, bottom: 600, height: 50 }, settings), true, 'ends exactly at Settings')
  assert.equal(seatIsSane({ top: 400, bottom: 450, height: 50 }, settings), true, 'higher up is fine')
  assert.equal(seatIsSane({ top: 640, bottom: 690, height: 50 }, settings), false, 'below the Settings row')
  assert.equal(seatIsSane({ top: 0, bottom: 0, height: 0 }, settings), true, 'unmeasurable is accepted')
  assert.equal(seatIsSane(null, settings), true)
  assert.equal(seatIsSane({ top: 640, bottom: 690, height: 50 }, null), true, 'nothing to compare against')
})

test('a seat that lands the pane below the Settings row is abandoned for the next one', () => {
  const document = fakeDocument()
  const { root, foot, footerActions, settings } = document.__fixture
  settings.__rect = () => ({ top: 600, bottom: 650, height: 50 })

  // Seat 0 puts the pane in the footer block, which this stub reports as being
  // below the Settings row; in the sidebar root the same stub reports a sane
  // rect, so the next seat must be taken.
  const originalInsert = foot.insertBefore.bind(foot)
  foot.insertBefore = (node, reference) => {
    if (node.getAttribute('data-dsh-sidebar-pins') !== null) {
      node.__rect = () =>
        node.parentElement === root
          ? { top: 550, bottom: 600, height: 50 }
          : { top: 660, bottom: 710, height: 50 }
    }
    return originalInsert(node, reference)
  }

  const { globals } = mount({ document })
  const pane = document.querySelector('[data-dsh-sidebar-pins]')

  assert.equal(pane.parentElement, root, 'the pane moved on to the next seat')
  assert.equal(pane.nextElementSibling, foot)
  assert.equal(globals.__dshSidebarPins.seat, 3)
  const notes = String(globals.__dshSidebarPins.notes.join(' | '))
  assert.match(notes, /put the pane below the Settings row/)
  assert.match(notes, /seated "above the footer content \(level 3\)"/)
  foot.insertBefore = originalInsert
  assert.equal(footerActions.parentElement, foot)
})

test('the seat survives the extra wrappers the real host adds', () => {
  // Measured on a live host: the sidebar root sits inside an extra unnamed div,
  // and each footer-slot entry sits inside its own div inside a row container.
  // Neither may move the pane: it belongs in the footer block, above Settings.
  const document = fakeDocument()
  const { root, column, foot, footerActions, entryWrapper, anchor } = document.__fixture
  column.removeChild(root)
  const wrapper = new FakeElement('div')
  wrapper.appendChild(root)
  column.appendChild(wrapper)

  const { globals } = mount({ document })
  const pane = document.querySelector('[data-dsh-sidebar-pins]')

  assert.equal(pane.parentElement, foot, 'the pane still lands in the footer block')
  assert.equal(pane.nextElementSibling, footerActions)
  assert.equal(entryWrapper.children.includes(pane), false, 'and never inside the slot entry wrapper')
  assert.equal(anchor.parentElement, entryWrapper, 'the anchor keeps its own place')
  assert.equal(wrapper.children.includes(pane), false, 'the pane is never a sibling of the sidebar root')
  assert.equal(foot.parentElement, root, 'the footer still belongs to the real sidebar root')
  assert.equal(globals.__dshSidebarPins.seat, 2)
  assert.equal(globals.__dshSidebarPins.paneConnected, true)
})

test('the diagnostics object reports the placement result', () => {
  const { document, globals } = mount()
  const diagnostics = globals.__dshSidebarPins
  const { foot, footerActions, anchor, entryWrapper, column } = document.__fixture
  assert.equal(diagnostics.version, '0.2.0')
  assert.equal(diagnostics.ignoredPosition, null, 'no legacy position key in this browser')
  assert.equal(diagnostics.paneConnected, true)
  assert.equal(diagnostics.paneParent, 'div.')
  assert.equal(diagnostics.paneNextSibling, 'div.')
  assert.equal(document.querySelector('[data-dsh-sidebar-pins]').parentElement, foot)
  assert.equal(document.querySelector('[data-dsh-sidebar-pins]').nextElementSibling, footerActions)
  assert.equal(diagnostics.anchors.anchor, 'span.')
  assert.equal(diagnostics.anchors.chain[0], 'div.')
  assert.equal(diagnostics.anchors.scope, 'div.')
  assert.equal(diagnostics.seat, 2)
  assert.deepEqual(
    plain(diagnostics.skipped),
    ['above the footer content (level 0)', 'above the footer content (level 1)']
  )
  assert.equal(diagnostics.rail, false)
  assert.equal(diagnostics.rows, 0, 'no session rows in the default fixture')
  assert.equal(diagnostics.rowButtons, 0)
  assert.equal(diagnostics.styleNode, true)
  assert.equal(diagnostics.pinned, 2)
  assert.deepEqual(plain(diagnostics.notes), [], 'a stock shell needs no warning')
  assert.notEqual(anchor.parentElement, null)
  assert.equal(entryWrapper.parentElement, footerActions)
  assert.equal(column.firstElementChild, document.__fixture.root)
})

test('the observer watches the sidebar body, the head, and the sidebar column\'s class', () => {
  const { document, observers } = mount()
  const { column } = document.__fixture
  const targets = observers[0].targets

  assert.equal(targets.some((entry) => entry.target === document.body), true, 'body: pane removal and re-renders')
  assert.equal(targets.some((entry) => entry.target === document.head), true, 'head: the style node')
  assert.equal(
    targets.some((entry) => entry.target === column && entry.options.attributeFilter?.includes('class')),
    true,
    'sidebar root: the list/rail switch'
  )
})

test('a mutation brings back a pane that was removed', async () => {
  const { document, observers } = mount()
  const { foot, footerActions } = document.__fixture
  const pane = document.querySelector('[data-dsh-sidebar-pins]')

  pane.remove()
  assert.equal(foot.querySelector('[data-dsh-sidebar-pins]'), null)

  observers[0].callback()
  await new Promise((resolve) => setTimeout(resolve, 160))

  const restored = document.querySelector('[data-dsh-sidebar-pins]')
  assert.equal(restored, pane, 'the same pane element comes back')
  assert.equal(restored.parentElement, foot)
  assert.equal(restored.nextElementSibling, footerActions, 'still directly above the Settings row')
})

test('a head mutation reinstates a style node removed by someone else', async () => {
  const { document, observers } = mount()
  const style = document.getElementById('dsh-sidebar-pins-style')
  assert.notEqual(style, null)

  style.remove()
  assert.equal(document.getElementById('dsh-sidebar-pins-style'), null)

  observers[0].callback()
  await new Promise((resolve) => setTimeout(resolve, 160))

  const restored = document.getElementById('dsh-sidebar-pins-style')
  assert.notEqual(restored, null, 'the stylesheet is reinstated')
  assert.match(restored.textContent, /\[data-dsh-sidebar-pins\]\{flex:0 1 30vh;/)
  assert.equal(document.querySelector('[data-dsh-sidebar-pins]').getAttribute('data-collapsed'), '0')
})

test('the header toggles collapse and the state is remembered per browser', () => {
  const { document, storage } = mount()
  const block = document.querySelector('[data-dsh-sidebar-pins]')
  const head = block.querySelector('.dsp-head')

  head.click()
  assert.equal(head.getAttribute('aria-expanded'), 'false')
  assert.equal(block.getAttribute('data-collapsed'), '1')
  assert.equal(block.querySelector('.dsp-list').children.length, 0)
  assert.equal(storage.getItem('dsh.sidebar-pins.collapsed'), '1')

  head.click()
  assert.equal(head.getAttribute('aria-expanded'), 'true')
  assert.equal(block.getAttribute('data-collapsed'), '0')
  assert.equal(block.querySelector('.dsp-list').children.length, 2)
})

test('a remembered collapse survives a remount, and an empty set shows the hint', () => {
  const remembered = mount({ storageSeed: { 'dsh.sidebar-pins.collapsed': '1' } })
  const block = remembered.document.querySelector('[data-dsh-sidebar-pins]')
  assert.equal(block.querySelector('.dsp-head').getAttribute('aria-expanded'), 'false')

  const empty = mount({ pinned: [], byId: {} })
  const emptyBlock = empty.document.querySelector('[data-dsh-sidebar-pins]')
  assert.equal(emptyBlock.querySelector('.dsp-count').textContent, '')
  assert.equal(emptyBlock.querySelector('.dsp-list').children[0].textContent, 'Нет закреплённых сессий')
})

test('every legacy surface of the replaced plugin is retired by default', () => {
  const { document } = mount()
  const style = document.getElementById('dsh-sidebar-pins-style')
  for (const selector of [
    '__dsh-session-pin-footer__',
    '__dsh-session-pin-header__',
    '__dsh-session-pin-row-controls__',
    '__dsh-session-pin-panel__',
    '__dsh-session-pin-nav__'
  ]) {
    assert.match(style.textContent, new RegExp(selector.replace(/[-_]/g, '\\$&')))
  }
  assert.match(style.textContent, /display:none !important/)

  const shown = mount({ storageSeed: { 'dsh.sidebar-pins.show-legacy': '1' } })
  assert.doesNotMatch(shown.document.getElementById('dsh-sidebar-pins-style').textContent, /__dsh-session-pin/)
})

test('a missing sidebar region degrades without throwing', () => {
  const { document, state } = mount({ document: fakeDocument({ overlay: false }) })
  assert.equal(typeof state.cleanup, 'function')
  assert.notEqual(document.getElementById('dsh-sidebar-pins-style'), null)
  state.cleanup()
  assert.equal(document.getElementById('dsh-sidebar-pins-style'), null)
})

test('unmount removes the block and the style node', () => {
  const { document, state } = mount()
  const { root } = document.__fixture
  assert.notEqual(document.querySelector('[data-dsh-sidebar-pins]'), null)
  state.cleanup()
  assert.equal(root.querySelector('[data-dsh-sidebar-pins]'), null)
  assert.equal(document.getElementById('dsh-sidebar-pins-style'), null)
})

test('syncRowButtons labels rows through the fiber, the title, and skips the rest', () => {
  const { exports } = loadBundle()
  const doc = fakeDocument()
  const { browser } = doc.__fixture
  const byId = {
    a: { displayTitle: 'Alpha' },
    b: { displayTitle: 'Beta' },
    c: { displayTitle: 'Shared' },
    d: { displayTitle: 'Shared' }
  }
  const fiberRow = sessionRow('a', { fiber: true })
  const titleRow = sessionRow('b', { title: 'Beta' })
  const ambiguousRow = sessionRow('c', { title: 'Shared' })
  const notASession = new FakeElement('div')
  notASession.attrs.role = 'treeitem'
  notASession.appendChild(new FakeElement('span'))
  for (const row of [fiberRow, titleRow, ambiguousRow, notASession]) browser.appendChild(row)

  const pins = {
    getSnapshot: () => ({ ids: ['a'], byId, byTitle: exports.__test.sessionIndex({ ids: ['a', 'b', 'c', 'd'], byId }).byTitle }),
    isPinned: (id) => id === 'a'
  }
  const result = exports.__test.syncRowButtons(doc, doc.__fixture.region, pins, { pin: 'Pin', unpin: 'Unpin' })

  assert.equal(result.painted, 2, 'the ambiguous title and the non-session row get no button')
  assert.equal(result.scanned, 4, 'the four rows added above')
  assert.equal(fiberRow.querySelector('.dsp-rowpin').getAttribute('data-id'), 'a')
  assert.equal(fiberRow.querySelector('.dsp-rowpin').className, 'dsp-rowpin dsp-rowpin-on')
  assert.equal(fiberRow.querySelector('.dsp-rowpin').getAttribute('aria-pressed'), 'true')
  assert.equal(titleRow.querySelector('.dsp-rowpin').getAttribute('data-id'), 'b')
  assert.equal(titleRow.querySelector('.dsp-rowpin').className, 'dsp-rowpin')
  assert.equal(titleRow.querySelector('.dsp-rowpin').getAttribute('aria-label'), 'Pin')
  assert.equal(ambiguousRow.querySelector('.dsp-rowpin'), null)
  assert.equal(notASession.querySelector('.dsp-rowpin'), null)

  // Idempotent: a second pass reuses the same button instead of stacking one.
  exports.__test.syncRowButtons(doc, doc.__fixture.region, pins, { pin: 'Pin', unpin: 'Unpin' })
  assert.equal(fiberRow.querySelectorAll('.dsp-rowpin').length, 1)
})

test('a title match works through nested spans, not just direct children', () => {
  const { exports } = loadBundle()
  const doc = fakeDocument()
  const { browser } = doc.__fixture
  const byId = { b: { displayTitle: 'Beta' } }
  const row = new FakeElement('div')
  row.attrs.role = 'treeitem'
  const wrapper = new FakeElement('span')
  const nested = new FakeElement('span')
  nested.textContent = 'Beta'
  wrapper.appendChild(nested)
  row.appendChild(wrapper)
  browser.appendChild(row)

  const pins = {
    getSnapshot: () => ({ ids: [], byId, byTitle: exports.__test.sessionIndex({ ids: ['b'], byId }).byTitle }),
    isPinned: () => false
  }
  const result = exports.__test.syncRowButtons(doc, doc.__fixture.region, pins, { pin: 'Pin', unpin: 'Unpin' })

  assert.equal(result.painted, 1)
  assert.equal(row.querySelector('.dsp-rowpin').getAttribute('data-id'), 'b')
})

test('a click on a row pin toggles through the delegated document listener', () => {
  const doc = fakeDocument()
  const { browser } = doc.__fixture
  browser.appendChild(sessionRow('a', { fiber: true }))
  const { state } = mount({ document: doc, pinned: [] })

  const button = browser.querySelector('.dsp-rowpin')
  assert.notEqual(button, null)
  assert.equal(button.getAttribute('data-id'), 'a')

  let stopped = false
  doc.dispatch('click', {
    target: button,
    preventDefault() {},
    stopPropagation() {
      stopped = true
    }
  })

  assert.deepEqual(plain(state.setCalls), [['sidebar-pins', 'pinned', ['a']]])
  assert.equal(stopped, true, 'the row\'s own click (open session) must not fire')
})

test('the session header toggle renders state and toggles its own session', () => {
  const { exports, reactStub } = loadBundle()
  const calls = []
  const pins = {
    subscribe: () => () => {},
    isPinned: (id) => id === 'a',
    toggle: (id) => calls.push(id)
  }
  const Button = exports.__test.createHeaderButton({ pin: 'Закрепить сессию', unpin: 'Открепить' }, pins)
  assert.equal(typeof Button, 'function')

  const pinned = Button({ sessionId: 'a' })
  assert.equal(pinned.type, 'button')
  assert.equal(pinned.props.className, 'dsp-header dsp-rowpin-on')
  assert.equal(pinned.props['aria-pressed'], 'true')
  assert.equal(pinned.props.title, 'Открепить')

  const loose = Button({ sessionId: 'z' })
  assert.equal(loose.props.className, 'dsp-header')
  assert.equal(loose.props['aria-pressed'], 'false')
  assert.equal(loose.props.title, 'Закрепить сессию')

  pinned.props.onClick({ stopPropagation() {} })
  assert.deepEqual(calls, ['a'])
  assert.equal(reactStub !== undefined, true)
})

test('the shell seats are registered: the session header toggle and the seat anchor', () => {
  const { state } = mount()
  assert.deepEqual(
    plain(state.slotRegistrations.map((entry) => entry.name)),
    ['conversation.session.header.actions', 'sidebar.footer.action']
  )
  assert.deepEqual(
    plain(state.components.map((entry) => entry.id)),
    ['dsh-sidebar-pins', 'dsh-sidebar-pins-anchor']
  )
  assert.equal(state.components.every((entry) => typeof entry.component === 'function'), true)
})

test('an empty own set adopts the legacy pins once, then owns the field', () => {
  const adopted = mount({ pinned: [], byId: { x: { displayTitle: 'X' }, y: { displayTitle: 'Y' } }, legacyPinned: ['x', 'y'] })
  assert.deepEqual(plain(adopted.state.setCalls), [['sidebar-pins', 'pinned', ['x', 'y']]])
  assert.equal(adopted.storage.getItem('dsh.sidebar-pins.legacy-adopted'), null, 'host mode does not touch the local flag')

  // Further rebuilds (a session-list change) must not queue the same write again.
  for (const listener of adopted.state.sessionListeners) listener()
  for (const listener of adopted.state.scopeListeners) listener()
  assert.deepEqual(plain(adopted.state.setCalls), [['sidebar-pins', 'pinned', ['x', 'y']]])

  const owned = mount({
    pinned: [],
    legacyPinned: ['x', 'y'],
    ownUser: { pinned: [] },
    byId: { x: { displayTitle: 'X' } }
  })
  assert.deepEqual(plain(owned.state.setCalls), [], 'an intentionally emptied set is never re-populated')
})

test('a namespace the client cannot reach falls back to localStorage', () => {
  const document = fakeDocument()
  const storage = memoryStorage({ 'dsh.sidebar-pins.pinned': JSON.stringify({ v: 1, pinned: ['a'] }) })
  const { exports } = loadBundle({
    document,
    navigator: { language: 'en-US' },
    MutationObserver: FakeMutationObserver,
    window: { localStorage: storage, setTimeout, clearTimeout }
  })
  const { ctx, state } = makeCtx({ pinned: ['a'] })
  // Force the unavailable branch: the client cannot see the namespace at all.
  ctx.settingsScope.bind = (spec) => ({
    getSnapshot: () => ({ status: 'unavailable', mode: 'host', value: undefined, user: undefined }),
    subscribe: () => () => {},
    set: () => Promise.resolve()
  })
  exports.apply(ctx)

  const block = document.querySelector('[data-dsh-sidebar-pins]')
  assert.equal(block.querySelector('.dsp-label').textContent, 'Pinned')
  assert.equal(block.querySelector('.dsp-count').textContent, '1')

  const unpin = block.querySelector('.dsp-list').children[0].querySelector('.dsp-unpin')
  unpin.closest = (selector) => (selector === '.dsp-unpin' ? unpin : block.querySelector('.dsp-list').children[0])
  block.querySelector('.dsp-list').click(unpin)
  assert.equal(storage.getItem('dsh.sidebar-pins.pinned'), JSON.stringify({ v: 1, pinned: [] }))
  assert.deepEqual(plain(state.setCalls), [])
})
