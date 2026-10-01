/**
 * dsh-sidebar-pins — host half.
 *
 * Owns the plugin's durable pin store (`sidebar-pins`) and performs a one-time
 * migration from the `session-pin` namespace of the plugin this one replaces
 * (`dsh-session-pin`), so pins survive that plugin's removal.
 *
 * The migration only runs while this plugin has never had a `pinned` value in
 * its own user layer; afterwards the browser owns the field and an intentional
 * empty set (everything unpinned) is never re-populated.
 *
 * ## Why the schema is hand-written
 *
 * The settings service touches a schema in exactly two duck-typed ways:
 * calling it to resolve a section, and `toJSON()` for the descriptor the
 * browser rehydrates. Importing `@deepseek-ai/schemastery` here would be
 * correct but unresolvable: a profile install links this package into
 * `node_modules`, and Node resolves a linked package's bare imports from its
 * real path (the workspace), which has no `node_modules` of its own — the
 * entry would fail to load with `ERR_MODULE_NOT_FOUND` and the namespace would
 * never register.
 *
 * The envelope below is therefore written by hand and MUST stay byte-compatible
 * with what the browser's vendored schemastery rehydrates. `scripts/check-schema-envelope.mjs`
 * proves it against that very implementation (run it after any DSH upgrade).
 *
 * Model-visible effects: none — no session events, no model traffic.
 *
 * @module dsh-sidebar-pins
 */

/** Loader-facing plugin name. */
export const name = 'dsh-sidebar-pins'

/** The settings service is the plugin's only host dependency. */
export const inject = ['settings']

/** This plugin's own durable namespace. */
const NAMESPACE = 'sidebar-pins'

/** Namespace of the plugin this one replaces (migration source only). */
const LEGACY_NAMESPACE = 'session-pin'

/** How many times to wait for the legacy namespace to appear, and how long. */
const MIGRATION_ATTEMPTS = 6
const MIGRATION_INTERVAL_MS = 500

/**
 * The serialized shape of
 * `z.object({ pinned: z.array(z.string()).default([]) })`, captured from that
 * expression's own `toJSON()` and verified against the shell's decoder.
 */
const SCHEMA_ENVELOPE = {
  uid: 3,
  refs: {
    0: { type: 'string', meta: {} },
    2: { type: 'array', meta: { default: [] }, inner: 0 },
    3: { type: 'object', meta: { default: {} }, dict: { pinned: 2 } }
  }
}

/**
 * Resolve one `sidebar-pins` section: `{ pinned: string[] }`, defaults applied,
 * non-string entries rejected exactly as the schemastery original would.
 * @param value - merged base/user section, or undefined.
 * @returns the resolved section.
 */
function PinSchema(value) {
  const input = value === null || value === undefined ? {} : value
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('$.expected object')
  }
  const raw = input.pinned
  if (raw === undefined) return { pinned: [] }
  if (!Array.isArray(raw)) throw new TypeError('$.pinned expected array')
  const pinned = []
  for (const id of raw) {
    if (typeof id !== 'string') throw new TypeError('$.pinned[] expected string')
    pinned.push(id)
  }
  return { pinned }
}

/** Serialized form consumed by the browser's settings schema service. */
PinSchema.toJSON = () => SCHEMA_ENVELOPE

/**
 * Keep only well-formed session ids, preserving order.
 * @param value - untrusted stored value.
 * @returns the id list.
 */
function normalizeIds(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const id of value) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Whether this plugin's user layer already owns the `pinned` field.
 * @param ctx - host context.
 * @returns true once the browser (or the migration) has written the field.
 */
function ownsPinnedField(ctx) {
  const descriptor = ctx.settings.describe().find((entry) => entry.ns === NAMESPACE)
  const user = descriptor?.user
  return typeof user === 'object' && user !== null && Object.prototype.hasOwnProperty.call(user, 'pinned')
}

/**
 * Register the namespace and migrate the legacy pin set once.
 * @param ctx - host context.
 */
export function apply(ctx) {
  ctx.settings.register(NAMESPACE, PinSchema, { base: { pinned: [] }, applies: 'live' })

  /**
   * Copy the legacy pin set into this plugin's namespace, then stop.
   * @param attempt - retry counter, bounded by {@link MIGRATION_ATTEMPTS}.
   */
  const migrate = (attempt) => {
    let owned
    try {
      owned = ownsPinnedField(ctx)
    } catch (error) {
      ctx.logger.warn(`dsh-sidebar-pins: pin migration skipped: ${String(error)}`)
      return
    }
    if (owned) return

    let legacy
    try {
      legacy = ctx.settings.get(LEGACY_NAMESPACE)
    } catch (error) {
      ctx.logger.warn(`dsh-sidebar-pins: pin migration skipped: ${String(error)}`)
      return
    }
    const pinned = normalizeIds(legacy?.pinned)

    if (pinned.length === 0) {
      // The legacy namespace may not be registered yet when this entry loads
      // first; retry briefly, then give up (a fresh install has nothing to copy).
      if (attempt < MIGRATION_ATTEMPTS) setTimeout(() => migrate(attempt + 1), MIGRATION_INTERVAL_MS)
      return
    }

    void ctx.settings
      .update(NAMESPACE, { pinned })
      .then(() => {
        ctx.logger.info(
          `dsh-sidebar-pins: migrated ${String(pinned.length)} pinned session(s) from "${LEGACY_NAMESPACE}"`
        )
      })
      .catch((error) => {
        ctx.logger.warn(`dsh-sidebar-pins: pin migration failed: ${String(error)}`)
      })
  }

  const timer = setTimeout(() => migrate(0), MIGRATION_INTERVAL_MS)
  ctx.effect(() => () => clearTimeout(timer), 'dsh-sidebar-pins: migration timer')
}
