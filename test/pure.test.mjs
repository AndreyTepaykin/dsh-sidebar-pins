import test from 'node:test'
import assert from 'node:assert/strict'
import { loadBundle } from './load-bundle.mjs'

const { registration, exports } = loadBundle()
const { normalizeIds, decodeLegacyPinned, rowModels, dictFor, withoutId } = exports.__test

/** Bundle values are created in another realm; compare structural copies. */
const plain = (value) => JSON.parse(JSON.stringify(value))

test('bundle registers under its package name with the expected shape', () => {
  assert.equal(registration.id, 'dsh-sidebar-pins')
  assert.equal(exports.name, 'dsh-sidebar-pins')
  assert.deepEqual([...exports.inject], ['slots', 'sessions', 'settingsScope'])
  assert.equal(typeof exports.apply, 'function')
})

test('normalizeIds drops empties and duplicates, preserving pin order', () => {
  assert.deepEqual(plain(normalizeIds(['b', 'a', 'b', '', null, 7, 'c'])), ['b', 'a', 'c'])
  assert.deepEqual(plain(normalizeIds(undefined)), [])
  assert.deepEqual(plain(normalizeIds('session-1')), [])
  assert.deepEqual(plain(normalizeIds([])), [])
})

test('decodeLegacyPinned accepts the bare array and every versioned document', () => {
  assert.deepEqual(plain(decodeLegacyPinned(JSON.stringify(['a', 'b']))), ['a', 'b'])
  assert.deepEqual(plain(decodeLegacyPinned(JSON.stringify({ v: 1, pinned: ['a'] }))), ['a'])
  assert.deepEqual(
    plain(decodeLegacyPinned(JSON.stringify({ v: 3, pinned: ['a', 'a', 'b'], colors: { a: '#eab308' } }))),
    ['a', 'b']
  )
  assert.deepEqual(plain(decodeLegacyPinned('not json')), [])
  assert.deepEqual(plain(decodeLegacyPinned(null)), [])
  assert.deepEqual(plain(decodeLegacyPinned(JSON.stringify({ v: 3 }))), [])
})

test('rowModels keeps pin order, resolves titles and flags stale ids', () => {
  const byId = { a: { displayTitle: 'Alpha' }, b: { displayTitle: '' } }
  assert.deepEqual(plain(rowModels(['a', 'b', 'gone'], byId)), [
    { id: 'a', title: 'Alpha', missing: false },
    { id: 'b', title: 'b', missing: false },
    { id: 'gone', title: 'gone', missing: true }
  ])
  assert.deepEqual(plain(rowModels(['a'], undefined)), [{ id: 'a', title: 'a', missing: true }])
})

test('withoutId removes every occurrence of one id', () => {
  assert.deepEqual(plain(withoutId(['a', 'b', 'a'], 'a')), ['b'])
  assert.deepEqual(plain(withoutId(['a'], 'zzz')), ['a'])
})

test('dictFor picks Russian for ru tags and English otherwise', () => {
  assert.equal(dictFor('ru-RU').label, 'Закреплённые')
  assert.equal(dictFor('ru').unpin, 'Открепить')
  assert.equal(dictFor('en-US').label, 'Pinned')
  assert.equal(dictFor(undefined).label, 'Pinned')
  assert.equal(dictFor('tr-TR').label, 'Pinned')
})
