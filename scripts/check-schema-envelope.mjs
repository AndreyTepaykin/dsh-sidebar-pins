/**
 * Scratch check: does a hand-written schema envelope rehydrate and validate in
 * the shell's OWN vendored schemastery (the code the browser uses to decode a
 * settings section)? Run once while wiring the host half.
 */
import { readFileSync } from 'node:fs'

const clientPath =
  'C:/Users/User/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/client.js'
const source = readFileSync(clientPath, 'utf8')
const regionMark = '//#region ../../../vendor/schemastery/src/index.ts'
const schemaStart = source.indexOf(regionMark)
if (schemaStart < 0) throw new Error('schemastery region not found')
const schemaEnd = source.indexOf('//#endregion', schemaStart)
// The vendored schema reuses helpers from the bundle's earlier regions, so take
// everything from the first region up to the end of the schemastery region.
const start = source.indexOf('//#region')
const region = source.slice(start, schemaEnd)

const factory = new Function(
  'mapValues',
  'isNullable',
  `${region}\nreturn { Schema, ValidationError };`
)
// The bundle's own helpers, lifted verbatim (client.js lines 23 and below).
const mapValues = (object, transform) =>
  Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]))
const isNullable = (value) => value === null || value === undefined
const { Schema, ValidationError } = factory(mapValues, isNullable)

const ENVELOPE = {
  uid: 3,
  refs: {
    0: { type: 'string', meta: {} },
    2: { type: 'array', meta: { default: [] }, inner: 0 },
    3: { type: 'object', meta: { default: {} }, dict: { pinned: 2 } }
  }
}

const schema = new Schema(ENVELOPE)
console.log('rehydrated type:', schema.type)
console.log('toJSON round trip equal:', JSON.stringify(schema.toJSON()) === JSON.stringify(ENVELOPE))
console.log('{pinned:["a","b"]} ->', JSON.stringify(schema({ pinned: ['a', 'b'] })))
console.log('{pinned:[]} ->', JSON.stringify(schema({ pinned: [] })))
console.log('{} ->', JSON.stringify(schema({})))
try {
  schema({ pinned: [1] })
  console.log('{pinned:[1]} -> ACCEPTED (bad)')
} catch (error) {
  console.log('{pinned:[1]} -> rejected by', error instanceof ValidationError ? 'ValidationError' : String(error))
}
try {
  schema({ pinned: 'nope' })
  console.log('{pinned:"nope"} -> ACCEPTED (bad)')
} catch (error) {
  console.log('{pinned:"nope"} -> rejected')
}
try {
  schema(null)
  console.log('null ->', JSON.stringify(schema(null)))
} catch (error) {
  console.log('null -> rejected:', error.message)
}
