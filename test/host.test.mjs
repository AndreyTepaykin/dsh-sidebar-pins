import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { apply, inject, name } from '../lib/index.js'

const SHELL_SETTINGS_CLIENT =
  'C:/Users/User/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/client.js'

function makeCtx(options = {}) {
  const registrations = []
  const updates = []
  const ctx = {
    logger: { info() {}, warn() {} },
    settings: {
      register(namespace, schema, registerOptions) {
        registrations.push({ namespace, schema, registerOptions })
      },
      describe: () => options.descriptors ?? [],
      get: (namespace) => (options.values ?? {})[namespace],
      update: (namespace, patch) => {
        updates.push([namespace, patch])
        return Promise.resolve()
      }
    },
    effect: (callback) => {
      callback()
      return () => {}
    }
  }
  return { ctx, registrations, updates }
}

test('the host half registers one namespace and nothing else', () => {
  const { ctx, registrations } = makeCtx()
  apply(ctx)

  assert.equal(name, 'dsh-sidebar-pins')
  assert.deepEqual([...inject], ['settings'])
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].namespace, 'sidebar-pins')
  assert.deepEqual(registrations[0].registerOptions, { base: { pinned: [] }, applies: 'live' })
})

test('the schema resolves defaults and rejects malformed sections like schemastery', () => {
  const { ctx, registrations } = makeCtx()
  apply(ctx)
  const schema = registrations[0].schema

  assert.deepEqual(schema({}), { pinned: [] })
  assert.deepEqual(schema(undefined), { pinned: [] })
  assert.deepEqual(schema(null), { pinned: [] })
  assert.deepEqual(schema({ pinned: ['a', 'b'] }), { pinned: ['a', 'b'] })
  assert.throws(() => schema({ pinned: [1] }), TypeError)
  assert.throws(() => schema({ pinned: 'nope' }), TypeError)
  assert.throws(() => schema([]), TypeError)
})

test('the serialized envelope is the captured schemastery graph', () => {
  const { ctx, registrations } = makeCtx()
  apply(ctx)
  assert.deepEqual(registrations[0].schema.toJSON(), {
    uid: 3,
    refs: {
      0: { type: 'string', meta: {} },
      2: { type: 'array', meta: { default: [] }, inner: 0 },
      3: { type: 'object', meta: { default: {} }, dict: { pinned: 2 } }
    }
  })
})

test('the legacy pin set is migrated once, and never after the field is owned', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const fresh = makeCtx({ values: { 'session-pin': { pinned: ['a', 'b', 'b'] } } })
  apply(fresh.ctx)
  t.mock.timers.tick(600)
  await Promise.resolve()
  assert.deepEqual(fresh.updates, [['sidebar-pins', { pinned: ['a', 'b'] }]])

  const owned = makeCtx({
    values: { 'session-pin': { pinned: ['a', 'b'] } },
    descriptors: [{ ns: 'sidebar-pins', user: { pinned: [] } }]
  })
  apply(owned.ctx)
  t.mock.timers.tick(600)
  await Promise.resolve()
  assert.deepEqual(owned.updates, [], 'an intentionally emptied set is never re-populated')

  const nothingToCopy = makeCtx({ values: {} })
  apply(nothingToCopy.ctx)
  t.mock.timers.tick(600 * 8)
  await Promise.resolve()
  assert.deepEqual(nothingToCopy.updates, [])
})

test('the envelope rehydrates and validates in the shell\'s own schemastery', (t) => {
  if (!existsSync(SHELL_SETTINGS_CLIENT)) {
    t.skip('DSH shell settings bundle not found on this machine')
    return
  }
  const { ctx, registrations } = makeCtx()
  apply(ctx)

  // Lift the shell's vendored schemastery (the decoder every settings section
  // passes through) and replay this plugin's envelope against it.
  const source = readFileSync(SHELL_SETTINGS_CLIENT, 'utf8')
  const mark = '//#region ../../../vendor/schemastery/src/index.ts'
  const schemaStart = source.indexOf(mark)
  const schemaEnd = source.indexOf('//#endregion', schemaStart)
  const region = source.slice(source.indexOf('//#region'), schemaEnd)
  const mapValues = (object, transform) =>
    Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]))
  const isNullable = (value) => value === null || value === undefined
  const factory = new Function(
    'mapValues',
    'isNullable',
    `${region}\nreturn { Schema, ValidationError };`
  )
  const { Schema, ValidationError } = factory(mapValues, isNullable)

  const rehydrated = new Schema(registrations[0].schema.toJSON())
  assert.equal(rehydrated.type, 'object')
  assert.deepEqual(rehydrated({ pinned: ['a', 'b'] }), { pinned: ['a', 'b'] })
  assert.deepEqual(rehydrated({}), { pinned: [] })
  assert.throws(() => rehydrated({ pinned: [1] }), ValidationError)
})
