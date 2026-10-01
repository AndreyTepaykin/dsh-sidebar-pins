/**
 * Minimal fake DOM, just enough to exercise the plugin's DOM-facing helpers
 * (locateRegion, createBlock, paintBlock, syncRowButtons) under `node --test`
 * without jsdom.
 *
 * Selector support is limited to the three forms the plugin uses: a class
 * selector, one simple attribute selector, and a tag name.
 */

/** @returns true when `element` matches one of the supported selectors. */
function matchesSelector(element, selector) {
  if (selector.startsWith('.')) return element.className.split(/\s+/).includes(selector.slice(1))
  const attribute = /^\[([A-Za-z0-9_-]+)(?:=(["'])(.*?)\2)?\]$/.exec(selector)
  if (attribute !== null) {
    const value = element.getAttribute(attribute[1])
    if (value === null) return false
    return attribute[3] === undefined || value === attribute[3]
  }
  return element.tagName === selector
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag
    this.children = []
    this.parentElement = null
    this.className = ''
    this.innerHTML = ''
    this.title = ''
    this.type = ''
    this.style = {}
    this.attrs = Object.create(null)
    this.listeners = Object.create(null)
    this.isConnected = false
    this._text = ''
  }

  get textContent() {
    return this._text
  }

  set textContent(value) {
    this._text = value
    if (value === '') this.children = []
  }

  get firstElementChild() {
    return this.children[0] ?? null
  }

  get lastElementChild() {
    return this.children.length === 0 ? null : this.children[this.children.length - 1]
  }

  get nextElementSibling() {
    if (this.parentElement === null) return null
    const index = this.parentElement.children.indexOf(this)
    return index < 0 ? null : (this.parentElement.children[index + 1] ?? null)
  }

  /**
   * Layout is not simulated: a rect is whatever the test installed, and an
   * unstubbed element measures as zero (which the plugin reads as "cannot
   * judge" and accepts).
   */
  getBoundingClientRect() {
    if (typeof this.__rect === 'function') return this.__rect()
    if (this.__rect !== undefined) return this.__rect
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value)
  }

  getAttribute(name) {
    return name in this.attrs ? this.attrs[name] : null
  }

  appendChild(child) {
    child.parentElement = this
    this.children.push(child)
    child.isConnected = true
    return child
  }

  insertBefore(child, reference) {
    child.parentElement = this
    const index = this.children.indexOf(reference)
    this.children.splice(index < 0 ? 0 : index, 0, child)
    child.isConnected = true
    return child
  }

  removeChild(child) {
    this.children = this.children.filter((candidate) => candidate !== child)
    child.parentElement = null
    child.isConnected = false
    return child
  }

  remove() {
    if (this.parentElement !== null) this.parentElement.removeChild(this)
  }

  addEventListener(type, listener) {
    if (this.listeners[type] === undefined) this.listeners[type] = []
    this.listeners[type].push(listener)
  }

  removeEventListener() {}

  contains(node) {
    if (node === this) return true
    return this.children.some((child) => child.contains(node))
  }

  /** Only the two selectors the plugin's click handler uses. */
  closest(selector) {
    if (selector.startsWith('.')) {
      const wanted = selector.slice(1)
      if (this.className.split(/\s+/).includes(wanted)) return this
      return this.parentElement === null ? null : this.parentElement.closest(selector)
    }
    return null
  }

  /** Depth-first pre-order, matching the block helpers' expectations. */
  querySelectorAll(selector) {
    const out = []
    const walk = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector)
    return all.length > 0 ? all[0] : null
  }

  /** Fire one click, as the browser would. */
  click(target) {
    const listeners = this.listeners.click ?? []
    const event = {
      target: target ?? this,
      stopped: false,
      defaultPrevented: false,
      stopPropagation() {
        this.stopped = true
      },
      preventDefault() {
        this.defaultPrevented = true
      }
    }
    for (const listener of listeners) listener(event)
    return event
  }
}

/**
 * Build a document-shaped object over `FakeElement`.
 * @param options - `{ overlay: boolean, row: boolean }` to steer locateRegion.
 */
function fakeDocument(options = {}) {
  const createElement = (tag) => new FakeElement(tag)
  const head = new FakeElement('head')
  const body = new FakeElement('body')

  const findById = (node, id) => {
    for (const child of node.children) {
      if (child.id === id) return child
      const hit = findById(child, id)
      if (hit !== null) return hit
    }
    return null
  }

  const doc = {
    head,
    body,
    createElement,
    getElementById(id) {
      return findById(head, id) ?? findById(body, id)
    },
    querySelector() {
      return null
    },
    // Layout is only as real as a test needs: an element reports its `__computed`
    // style, and an unstubbed one measures as block/column (which stacks).
    defaultView: {
      getComputedStyle: (element) =>
        element.__computed ?? { display: 'block', flexDirection: 'column' }
    }
  }

  if (options.overlay !== false) {
    const row = new FakeElement('div')
    row.attrs.role = 'treeitem'

    // No session row by default: the seat is derived from the anchor, and rows
    // may legitimately be absent (a rail sidebar). Tests that need rows add them.
    const browser = new FakeElement('div')
    if (options.row === true) browser.appendChild(row)

    const region = new FakeElement('div')
    region.appendChild(browser)

    // The footer block that follows the region in the real shell: it holds the
    // footer actions block (where the plugin renders its seat anchor) and then
    // the Settings row block. The pane's seat is derived from the anchor alone.
    const footerActions = new FakeElement('div')
    // The stock shell lays the footer's slot entries out in a row, and a live
    // host wraps each entry in its own `div` — both are reproduced here.
    footerActions.__computed = { display: 'flex', flexDirection: 'row' }
    const entryWrapper = new FakeElement('div')
    const anchor = new FakeElement('span')
    anchor.attrs['data-dsh-sidebar-pins-anchor'] = ''
    if (options.anchor !== false) entryWrapper.appendChild(anchor)
    footerActions.appendChild(entryWrapper)

    const settings = new FakeElement('div')
    settings.appendChild(new FakeElement('span'))

    const foot = new FakeElement('div')
    foot.appendChild(footerActions)
    foot.appendChild(settings)

    const root = new FakeElement('div')
    root.appendChild(region)
    root.appendChild(foot)

    const column = new FakeElement('div')
    column.appendChild(root)

    const frame = new FakeElement('div')
    frame.appendChild(column)

    const overlay = new FakeElement('div')
    overlay.attrs['data-shell-overlay'] = ''
    frame.appendChild(overlay)

    doc.querySelector = (selector) =>
      matchesSelector(frame, selector) ? frame : frame.querySelector(selector)

    doc.__fixture = {
      overlay,
      frame,
      column,
      root,
      region,
      foot,
      footerActions,
      entryWrapper,
      anchor,
      settings,
      browser,
      row
    }
  }

  const documentListeners = Object.create(null)
  doc.addEventListener = (type, listener) => {
    if (documentListeners[type] === undefined) documentListeners[type] = []
    documentListeners[type].push(listener)
  }
  doc.removeEventListener = (type, listener) => {
    documentListeners[type] = (documentListeners[type] ?? []).filter((candidate) => candidate !== listener)
  }
  /** Fire one delegated document event, as the browser's capture phase would. */
  doc.dispatch = (type, event) => {
    for (const listener of documentListeners[type] ?? []) listener(event)
  }

  return doc
}

export { FakeElement, fakeDocument, matchesSelector }
