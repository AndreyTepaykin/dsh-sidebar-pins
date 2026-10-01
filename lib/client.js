window.__ModuleLoader__.load({
  id: "dsh-sidebar-pins",
  factory: (require) => {
    "use strict";
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    /**
     * dsh-sidebar-pins — browser half.
     *
     * Self-contained pinned sessions for the DSH sidebar: its own pin store, its
     * own pin buttons (session row + session header), and a "Pinned" block at the
     * top of the sidebar. It replaces every surface of `dsh-session-pin`, which
     * cannot deliver them on DSH 0.1.5:
     *
     *   - that plugin reorders the HOST list (`workspaces.insertSessionBefore`),
     *     while the sidebar renders a BROWSER-LOCAL order
     *     (`dsh.workspace.view.v5`), so its pinned prefix never reaches the
     *     screen — and the plugin API exposes no way to write the local order;
     *   - `sidebar.workspaces` is declared `kind: "single"`, so a second plugin
     *     cannot add a block there; the block is placed by DOM instead;
     *   - `sessions.row.action` is not declared on this baseline, so row buttons
     *     are a DOM overlay (the same technique the replaced plugin uses).
     *
     * Durable state lives in this plugin's own `sidebar-pins` settings namespace
     * (localStorage fallback). The host half migrates the old `session-pin` set
     * once, so pins survive that plugin's removal.
     *
     * Model-visible effects: none.
     */

    // ------------------------------------------------------------------ constants

    /** This plugin's own durable namespace (registered by the host half). */
    var NS = "sidebar-pins";
    /** Migration source / read-only fallback. */
    var LEGACY_NS = "session-pin";
    /** Browser-local fallback documents. */
    var LOCAL_KEY = "dsh.sidebar-pins.pinned";
    var LEGACY_LOCAL_KEY = "dsh.session-pin.pinned";
    var MIGRATED_KEY = "dsh.sidebar-pins.legacy-adopted";
    var COLLAPSE_KEY = "dsh.sidebar-pins.collapsed";
    /**
     * No longer read: the pane's seat is fixed (last child of the session
     * region, i.e. directly above the Settings row). The constant stays so a
     * leftover value in a browser's localStorage cannot move the pane.
     */
    var POSITION_KEY = "dsh.sidebar-pins.position";
    var SHOW_LEGACY_KEY = "dsh.sidebar-pins.show-legacy";
    var DEBUG_KEY = "dsh.sidebar-pins.debug";
    var STYLE_ID = "dsh-sidebar-pins-style";
    var BLOCK_ATTR = "data-dsh-sidebar-pins";
    /** Attribute of the placeholder this plugin renders into the sidebar foot. */
    var ANCHOR_ATTR = "data-dsh-sidebar-pins-anchor";
    var P = "dsp";
    /** Reported by the always-on diagnostics object (`window.__dshSidebarPins`). */
    var VERSION = "0.2.0";
    /** A sidebar narrower than this is a rail, not a list. */
    var RAIL_WIDTH_PX = 120;

    var PIN_SVG =
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"' +
      ' stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';

    var DICT = {
      en: {
        label: "Pinned",
        empty: "No pinned sessions",
        pin: "Pin session",
        unpin: "Unpin",
        open: "Open session",
        collapse: "Collapse",
        expand: "Expand"
      },
      ru: {
        label: "Закреплённые",
        empty: "Нет закреплённых сессий",
        pin: "Закрепить сессию",
        unpin: "Открепить",
        open: "Открыть сессию",
        collapse: "Свернуть",
        expand: "Развернуть"
      }
    };

    // ------------------------------------------------------------------ pure logic

    /**
     * Drop empty and duplicate ids, preserving order (first pin first).
     * @param value - untrusted stored value.
     * @returns the normalized id list.
     */
    function normalizeIds(value) {
      var out = [];
      var seen = Object.create(null);
      if (!Array.isArray(value)) return out;
      for (var i = 0; i < value.length; i += 1) {
        var id = value[i];
        if (typeof id !== "string" || id.length === 0 || seen[id] === true) continue;
        seen[id] = true;
        out.push(id);
      }
      return out;
    }

    /**
     * Read a browser-local pin document: a bare array, or a versioned object
     * whose `pinned` field holds the ids.
     * @param raw - raw localStorage string (or null).
     * @returns the pinned id list.
     */
    function decodeLegacyPinned(raw) {
      if (typeof raw !== "string" || raw.length === 0) return [];
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        return [];
      }
      if (Array.isArray(parsed)) return normalizeIds(parsed);
      if (typeof parsed === "object" && parsed !== null) return normalizeIds(parsed.pinned);
      return [];
    }

    /**
     * Remove one id from a list.
     * @param ids - current ids.
     * @param id - id to drop.
     * @returns a new list without that id.
     */
    function withoutId(ids, id) {
      var out = [];
      for (var i = 0; i < ids.length; i += 1) if (ids[i] !== id) out.push(ids[i]);
      return out;
    }

    /**
     * Newest pin first: pin an id, or unpin it when already pinned.
     * @param ids - current ids.
     * @param id - id to toggle.
     * @returns the next id list.
     */
    function toggleId(ids, id) {
      return ids.indexOf(id) === -1 ? [id].concat(ids) : withoutId(ids, id);
    }

    /**
     * One row per pinned id, newest pin first, with a live title when the
     * session still exists. Stale ids stay visible (the × button can drop them)
     * instead of vanishing silently.
     * @param ids - pinned ids in pin order.
     * @param byId - session summaries keyed by id.
     * @returns renderable row models.
     */
    function rowModels(ids, byId) {
      var rows = [];
      for (var i = 0; i < ids.length; i += 1) {
        var id = ids[i];
        var summary = byId === undefined || byId === null ? undefined : byId[id];
        var title =
          summary !== undefined &&
          summary !== null &&
          typeof summary.displayTitle === "string" &&
          summary.displayTitle.length > 0
            ? summary.displayTitle
            : id;
        rows.push({ id: id, title: title, missing: summary === undefined || summary === null });
      }
      return rows;
    }

    /**
     * Index live session titles for the DOM overlay's fallback lookup. Blank
     * sessions are skipped, and the array length records ambiguity.
     * @param list - `{ ids, byId }` session snapshot.
     * @returns `{ byId, byTitle }` lookup maps.
     */
    function sessionIndex(list) {
      var byId = list !== null && list !== undefined && list.byId !== undefined && list.byId !== null ? list.byId : {};
      var byTitle = Object.create(null);
      var ids = list !== null && list !== undefined && Array.isArray(list.ids) ? list.ids : [];
      for (var i = 0; i < ids.length; i += 1) {
        var id = ids[i];
        var summary = byId[id];
        if (summary === undefined || summary === null || summary.blank === true) continue;
        var title = summary.displayTitle;
        if (typeof title !== "string" || title.length === 0) continue;
        if (byTitle[title] === undefined) byTitle[title] = [];
        byTitle[title].push(id);
      }
      return { byId: byId, byTitle: byTitle };
    }

    /**
     * Recover a session id from a sidebar row.
     *
     * Primary path: React 18 stamps every host node with its fiber
     * (`__reactFiber$…`); walking up finds the row component's props, which
     * carry `node.id`. Fallback path: any descendant `span` whose text is a
     * title that exactly one live session owns — ambiguous titles are skipped
     * rather than guessed. The fallback is what the replaced plugin used, so it
     * is known to match this shell's rows.
     *
     * @param row - one `role="treeitem"` element.
     * @param index - `{ byId, byTitle }` from {@link sessionIndex}.
     * @returns the session id, or null when the row is not a session row.
     */
    function sessionIdOfRow(row, index) {
      var byId = index.byId;
      var keys = Object.keys(row);
      for (var i = 0; i < keys.length; i += 1) {
        if (keys[i].indexOf("__reactFiber$") !== 0) continue;
        var fiber = row[keys[i]];
        for (var depth = 0; fiber !== null && fiber !== undefined && depth < 40; depth += 1) {
          var props = fiber.memoizedProps;
          if (props !== null && props !== undefined && typeof props === "object") {
            var node = props.node;
            if (
              node !== null &&
              node !== undefined &&
              typeof node.id === "string" &&
              byId[node.id] !== undefined
            ) {
              return node.id;
            }
          }
          fiber = fiber.return;
        }
      }
      var spans = row.querySelectorAll("span");
      for (var j = 0; j < spans.length; j += 1) {
        var text = spans[j].textContent;
        if (typeof text !== "string" || text.length === 0) continue;
        var matches = index.byTitle[text];
        if (matches !== undefined && matches.length === 1) return matches[0];
      }
      return null;
    }

    /**
     * Pick a dictionary from a BCP-47 tag.
     * @param tag - `navigator.language` or similar.
     * @returns the dictionary for that language, English otherwise.
     */
    function dictFor(tag) {
      return typeof tag === "string" && /^ru\b/i.test(tag) ? DICT.ru : DICT.en;
    }

    // ------------------------------------------------------------------ browser storage

    /** localStorage access that never throws (private mode, disabled storage). */
    function guardedStorage() {
      return {
        get: function (key) {
          try {
            return window.localStorage.getItem(key);
          } catch (error) {
            return null;
          }
        },
        set: function (key, value) {
          try {
            window.localStorage.setItem(key, value);
          } catch (error) {
            /* storage is optional */
          }
        }
      };
    }

    // ------------------------------------------------------------------ styles

    var STYLE_TEXT = [
      // The pane is a slice of the sidebar height (the sidebar spans the window,
      // so vh tracks it), and the pad scrolls once the pins outgrow it. The
      // shrink factor is 1 on purpose: if the sidebar is ever too short, the pane
      // gives space back instead of pushing the Settings row out of view.
      "[" + BLOCK_ATTR + "]{flex:0 1 30vh;min-height:0;box-sizing:border-box;display:flex;",
      "flex-direction:column;gap:1px;margin:0;min-width:0;width:100%;padding:4px 0 0 4px;",
      "border-top:1px solid var(--dsw-alias-border-l3,rgba(140,149,159,.18));}",
      // The seat anchor itself takes no space.
      "[" + ANCHOR_ATTR + "]{display:none;}",
      // A rail sidebar has no room for the list or for words: header line only,
      // centred on the pin icon and the count.
      "[" + BLOCK_ATTR + "][data-rail='1']{flex:0 0 auto;padding-top:0;}",
      "[" + BLOCK_ATTR + "][data-rail='1'] ." + P + "-list{display:none;}",
      "[" + BLOCK_ATTR + "][data-rail='1'] ." + P + "-chev{display:none;}",
      "[" + BLOCK_ATTR + "][data-rail='1'] ." + P + "-head{justify-content:center;gap:4px;padding:0;}",
      "[" + BLOCK_ATTR + "][data-rail='1'] ." + P + "-count{margin-left:0;font-size:11px;}",
      // Folded, the pane shrinks to its header line and hands the space back.
      "[" + BLOCK_ATTR + "][data-collapsed='1']{flex:0 0 auto;padding-top:0;}",
      "[" + BLOCK_ATTR + "] ." + P + "-head{all:unset;box-sizing:border-box;display:flex;align-items:center;",
      "gap:6px;width:100%;height:28px;padding:0 6px;border-radius:8px;cursor:pointer;flex:none;",
      "color:var(--dsw-alias-label-tertiary,#8b949e);font-size:11px;letter-spacing:.04em;text-transform:uppercase;}",
      "[" + BLOCK_ATTR + "] ." + P + "-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(140,149,159,.14));}",
      "[" + BLOCK_ATTR + "] ." + P + "-head:focus-visible{outline:2px solid #3884ff;outline-offset:1px;}",
      "[" + BLOCK_ATTR + "] ." + P + "-chev{width:10px;text-align:center;flex:none;font-size:10px;}",
      "[" + BLOCK_ATTR + "] ." + P + "-count{margin-left:auto;font-size:10px;opacity:.8;}",
      // The pad is the scroll container once the pins outgrow the pane.
      "[" + BLOCK_ATTR + "] ." + P + "-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;",
      "overscroll-behavior:contain;scrollbar-width:thin;",
      "scrollbar-color:var(--dsh-scrollbar-thumb,rgba(140,149,159,.4)) transparent;}",
      "[" + BLOCK_ATTR + "] ." + P + "-row{display:flex;align-items:center;gap:6px;height:28px;padding:0 6px;",
      "border-radius:8px;cursor:pointer;min-width:0;flex:none;",
      "color:var(--dsw-alias-label-primary,#e6edf3);font-size:13px;}",
      "[" + BLOCK_ATTR + "] ." + P + "-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(140,149,159,.14));}",
      "[" + BLOCK_ATTR + "] ." + P + "-row[data-missing='1']{opacity:.55;}",
      "[" + BLOCK_ATTR + "] ." + P + "-pin{flex:none;display:inline-flex;color:#eab308;}",
      "[" + BLOCK_ATTR + "] ." + P + "-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      "[" + BLOCK_ATTR + "] ." + P + "-unpin{all:unset;flex:none;width:16px;height:16px;display:inline-flex;",
      "align-items:center;justify-content:center;border-radius:4px;cursor:pointer;",
      "color:var(--dsw-alias-label-tertiary,#8b949e);opacity:0;font-size:12px;line-height:1;}",
      "[" + BLOCK_ATTR + "] ." + P + "-row:hover ." + P + "-unpin{opacity:1;}",
      "[" + BLOCK_ATTR + "] ." + P + "-unpin:focus-visible{opacity:1;outline:2px solid #3884ff;}",
      "[" + BLOCK_ATTR + "] ." + P + "-empty{padding:2px 6px 4px;font-size:12px;",
      "color:var(--dsw-alias-label-tertiary,#8b949e);}",
      // Row pin button: in-flow like the control it replaces, revealed on hover.
      "button." + P + "-rowpin{all:unset;box-sizing:border-box;flex:none;width:16px;height:16px;",
      "display:inline-flex;align-items:center;justify-content:center;border-radius:4px;cursor:pointer;",
      "color:var(--dsw-alias-label-tertiary,#8b949e);opacity:0;margin-right:2px;}",
      "[role='treeitem']:hover button." + P + "-rowpin,button." + P + "-rowpin:focus-visible,",
      "button." + P + "-rowpin." + P + "-rowpin-on{opacity:1;}",
      "button." + P + "-rowpin." + P + "-rowpin-on{color:#eab308;}",
      "button." + P + "-rowpin:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(140,149,159,.14));}",
      // Header toggle: always visible, amber while pinned.
      "button." + P + "-header{all:unset;box-sizing:border-box;width:24px;height:24px;display:inline-flex;",
      "align-items:center;justify-content:center;border-radius:6px;cursor:pointer;",
      "color:var(--dsw-alias-label-secondary,#8b949e);}",
      "button." + P + "-header:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(140,149,159,.14));}",
      "button." + P + "-header." + P + "-rowpin-on{color:#eab308;background:rgba(234,179,8,.12);}"
    ].join("");

    /** Rules that retire the surfaces the replaced plugin used to render. */
    var LEGACY_RULES =
      "button.__dsh-session-pin-footer__,button.__dsh-session-pin-header__," +
      "span.__dsh-session-pin-row-controls__,div.__dsh-session-pin-panel__," +
      "div.__dsh-session-pin-nav__{display:none !important;}";

    /**
     * Install (or refresh) the plugin style node.
     *
     * Idempotent and self-healing: it is also called on every seat pass, so a
     * style node removed by anything else (a duplicate plugin instance being
     * disposed, a stray cleanup) is reinstated instead of leaving the pane
     * unstyled — an unstyled pane grows with all of its rows and pushes the
     * Settings row out of the sidebar.
     *
     * @param storage - guarded browser storage.
     * @returns true when the node is in the document.
     */
    function installStyle(storage) {
      var wanted = storage.get(SHOW_LEGACY_KEY) === "1" ? STYLE_TEXT : STYLE_TEXT + LEGACY_RULES;
      var tag = document.getElementById(STYLE_ID);
      if (tag === null) {
        tag = document.createElement("style");
        tag.id = STYLE_ID;
        document.head.appendChild(tag);
      }
      if (tag.textContent !== wanted) tag.textContent = wanted;
      return tag.parentElement !== null;
    }

    // ------------------------------------------------------------------ pin store

    /**
     * Durable pin set with optimistic local state.
     *
     * Primary residence is this plugin's own settings namespace; a namespace
     * the client cannot reach degrades to a versioned localStorage document.
     * The legacy namespace is read once as an adoption source for installs that
     * predate the host-side migration.
     *
     * @param ctx - client plugin context.
     * @param storage - guarded browser storage.
     * @param warn - diagnostics sink.
     * @returns the store handle.
     */
    function createPinStore(ctx, storage, warn) {
      var scope = ctx.settingsScope.bind({ namespace: NS });
      var legacyScope = ctx.settingsScope.bind({ namespace: LEGACY_NS });
      var listeners = new Set();
      var state = { ids: [], byId: {}, byTitle: Object.create(null) };
      var disposers = [];
      /** Adoption happens at most once per page load, so a slow write echo cannot repeat it. */
      var adopted = false;

      var isLocal = function () {
        var snapshot = scope.getSnapshot();
        return snapshot.mode === "memory" || snapshot.status === "unavailable";
      };

      var ownsField = function () {
        var snapshot = scope.getSnapshot();
        var user = snapshot.user;
        return typeof user === "object" && user !== null && Object.prototype.hasOwnProperty.call(user, "pinned");
      };

      var readLocal = function () {
        return decodeLegacyPinned(storage.get(LOCAL_KEY));
      };

      var readLegacy = function () {
        var snapshot = legacyScope.getSnapshot();
        if (snapshot.mode === "memory" || snapshot.status === "unavailable") {
          return decodeLegacyPinned(storage.get(LEGACY_LOCAL_KEY));
        }
        var value = snapshot.value;
        return normalizeIds(value === undefined || value === null ? undefined : value.pinned);
      };

      var notify = function () {
        var current = Array.from(listeners);
        for (var i = 0; i < current.length; i += 1) current[i]();
      };

      var write = function (ids) {
        state = { ids: ids, byId: state.byId, byTitle: state.byTitle };
        notify();
        if (isLocal()) {
          storage.set(LOCAL_KEY, JSON.stringify({ v: 1, pinned: ids }));
          storage.set(MIGRATED_KEY, "1");
          return;
        }
        Promise.resolve(scope.set("pinned", ids)).catch(function (error) {
          warn("pin write rejected: " + String(error));
        });
      };

      var readIds = function () {
        var mine = isLocal() ? readLocal() : normalizeIds(scope.getSnapshot().value?.pinned);
        if (mine.length > 0 || ownsField() || adopted || storage.get(MIGRATED_KEY) === "1") return mine;
        adopted = true;
        var legacy = readLegacy();
        if (legacy.length === 0) return mine;
        warn("adopted " + String(legacy.length) + " pin(s) from \"" + LEGACY_NS + "\"");
        write(legacy);
        return legacy;
      };

      var rebuild = function () {
        var list = ctx.sessions.list.getSnapshot();
        var index = sessionIndex(list);
        state = { ids: readIds(), byId: index.byId, byTitle: index.byTitle };
        notify();
      };

      return {
        subscribe: function (listener) {
          listeners.add(listener);
          return function () {
            listeners.delete(listener);
          };
        },
        getSnapshot: function () {
          return state;
        },
        isPinned: function (id) {
          return state.ids.indexOf(id) !== -1;
        },
        toggle: function (id) {
          write(toggleId(state.ids, id));
        },
        unpin: function (id) {
          write(withoutId(state.ids, id));
        },
        refresh: rebuild,
        start: function () {
          disposers.push(
            scope.subscribe(rebuild),
            legacyScope.subscribe(rebuild),
            ctx.sessions.list.subscribe(rebuild)
          );
          rebuild();
        },
        stop: function () {
          var current = disposers.splice(0);
          for (var i = 0; i < current.length; i += 1) current[i]();
          listeners.clear();
        }
      };
    }

    // ------------------------------------------------------------------ sidebar lookup

    /** How far up from the anchor the seat candidates are collected. */
    var ANCHOR_CHAIN_DEPTH = 5;
    /**
     * How many chain levels may serve as seats. The level above the sidebar root
     * is excluded on purpose: a pane there would sit above the whole sidebar.
     * Measured chains put the sidebar root at level 2 or 3.
     */
    var MAX_CHAIN_SEATS = 4;

    /**
     * Walk the anchor's ancestor chain and record one candidate seat per level.
     *
     * Every entry of the shell's footer slot is wrapped in its own `div` on a
     * live host, so the number of levels between the anchor and the footer block
     * is not fixed and can change between builds. Instead of assuming a chain,
     * each level is recorded as a candidate — `container` to insert into,
     * `before` to insert ahead of (the child that leads to the anchor), and
     * `after` for the block that follows it inside that container (the Settings
     * block, when the level is the one that holds it).
     *
     * The walk stops before the shell frame (the element that carries the
     * overlay layer), so the chain never escapes the sidebar column.
     *
     * @param doc - owning document.
     * @returns `{ anchor, levels }` with levels ordered innermost first, or null
     *   while the anchor is not in the document yet.
     */
    function footerSeat(doc) {
      var anchor = doc.querySelector("[" + ANCHOR_ATTR + "]");
      if (anchor === null) return null;
      var levels = [];
      var child = anchor;
      for (var depth = 0; depth < ANCHOR_CHAIN_DEPTH; depth += 1) {
        var container = child.parentElement;
        if (container === null || container === undefined) break;
        // The frame holds the overlay layer; nothing above it belongs to us.
        if (typeof container.querySelector === "function" && container.querySelector("[data-shell-overlay]") !== null) {
          break;
        }
        levels.push({ container: container, before: child, after: child.nextElementSibling });
        child = container;
      }
      if (levels.length === 0) return null;
      return { anchor: anchor, levels: levels };
    }

    /**
     * The element row buttons are scanned in: the outermost level of the anchor
     * chain, which is inside the sidebar column but still contains the list.
     * @param seat - result of {@link footerSeat}.
     * @returns the element to scan.
     */
    function scopeOf(seat) {
      return seat.levels[seat.levels.length - 1].container;
    }

    /**
     * Whether a container stacks its children vertically, so a pane placed in it
     * sits *above* what follows instead of beside it.
     *
     * Measured rather than assumed, because the chain differs per build: on a
     * live host the footer's entries sit in a `row` flex container, where the
     * pane's height cap would become a width and it would squeeze in next to the
     * Settings button. A container that is itself an item of a row is rejected
     * for the same reason.
     *
     * @param doc - owning document.
     * @param node - candidate container.
     * @returns true when the pane may be placed there, or when layout cannot be read.
     */
    function stacksVertically(doc, node) {
      if (node === null || node === undefined) return false;
      var view = doc.defaultView;
      if (view === null || view === undefined || typeof view.getComputedStyle !== "function") return true;
      var isRow = function (target) {
        if (target === null || target === undefined) return false;
        try {
          var style = view.getComputedStyle(target);
          if (style === null || style === undefined) return false;
          if (typeof style.display === "string" && style.display.indexOf("flex") === -1) return false;
          return style.flexDirection === "row" || style.flexDirection === "row-reverse";
        } catch (error) {
          return false;
        }
      };
      if (isRow(node)) return false;
      return !isRow(node.parentElement);
    }

    /**
     * The placeholder component this plugin renders into `sidebar.footer.action`.
     *
     * The shell renders that slot inside the footer block, immediately above the
     * Settings row, so the placeholder's position is guaranteed by the slot
     * contract instead of by a guess about the session list. The pane is then
     * seated next to it.
     *
     * @returns the anchor component.
     */
    function createAnchor() {
      return function PinAnchor() {
        return React.createElement("span", { "data-dsh-sidebar-pins-anchor": "", "aria-hidden": "true" });
      };
    }

    /**
     * Whether the sidebar is a rail (collapsed): measured, because the rail's
     * class name is hashed per build. A rail shows no session rows at all.
     * @param root - the sidebar root element.
     * @returns true when the root is too narrow to hold a list.
     */
    function isRail(root) {
      if (root === null || root === undefined || typeof root.getBoundingClientRect !== "function") return false;
      try {
        var rect = root.getBoundingClientRect();
        return rect.width > 0 && rect.width < RAIL_WIDTH_PX;
      } catch (error) {
        return false;
      }
    }

    /**
     * Whether a measured seat is geometrically plausible: the pane has to end up
     * ABOVE the Settings row.
     *
     * This is what makes seating self-correcting. A structural relation can hold
     * and still be visually wrong — a seat that resolves to a wrapper around the
     * sidebar puts the pane above everything, and one that appends to the root
     * puts it below the Settings row.
     *
     * @param pane - pane rect.
     * @param settings - Settings-block rect, or null.
     * @returns true when the seat is acceptable, or cannot be judged.
     */
    function seatIsSane(pane, settings) {
      if (pane === undefined || pane === null || pane.height === 0) return true;
      if (settings === undefined || settings === null || settings.height === 0) return true;
      return pane.bottom <= settings.top + 2;
    }

    // ------------------------------------------------------------------ block rendering

    /**
     * Build the block skeleton once; later paints only refill the list.
     * @param doc - owning document.
     * @param t - dictionary.
     * @param handlers - `{ toggle, open, unpin }`.
     * @returns the block element.
     */
    function createBlock(doc, t, handlers) {
      var block = doc.createElement("div");
      block.setAttribute(BLOCK_ATTR, "");
      block.setAttribute("role", "group");

      var head = doc.createElement("button");
      head.type = "button";
      head.className = P + "-head";
      var chev = doc.createElement("span");
      chev.className = P + "-chev";
      var icon = doc.createElement("span");
      icon.className = P + "-pin";
      icon.innerHTML = PIN_SVG;
      var label = doc.createElement("span");
      label.className = P + "-label";
      var count = doc.createElement("span");
      count.className = P + "-count";
      head.appendChild(chev);
      head.appendChild(icon);
      head.appendChild(label);
      head.appendChild(count);
      head.addEventListener("click", function (event) {
        event.stopPropagation();
        handlers.toggle();
      });

      var list = doc.createElement("div");
      list.className = P + "-list";
      list.addEventListener("click", function (event) {
        var target = event.target;
        if (target === null || typeof target.closest !== "function") return;
        var row = target.closest("." + P + "-row");
        if (row === null || !block.contains(row)) return;
        var id = row.getAttribute("data-id");
        if (id === null || id.length === 0) return;
        event.stopPropagation();
        if (target.closest("." + P + "-unpin") !== null) handlers.unpin(id);
        else handlers.open(id);
      });

      block.appendChild(head);
      block.appendChild(list);
      return block;
    }

    /**
     * Refill a block from the current snapshot.
     * @param doc - owning document.
     * @param block - block element created by {@link createBlock}.
     * @param state - `{ rows, collapsed, rail, t }`.
     */
    function paintBlock(doc, block, state) {
      var t = state.t;
      var head = block.querySelector("." + P + "-head");
      var chev = block.querySelector("." + P + "-chev");
      var label = block.querySelector("." + P + "-label");
      var count = block.querySelector("." + P + "-count");
      var list = block.querySelector("." + P + "-list");
      if (head === null || chev === null || label === null || count === null || list === null) return;
      block.setAttribute("data-collapsed", state.collapsed ? "1" : "0");
      chev.textContent = state.collapsed ? "\u25B8" : "\u25BE";
      // In the rail there is no room for words: the head keeps the pin icon and
      // the count only, which is what the shell's own rail controls do.
      label.textContent = state.rail ? "" : t.label;
      count.textContent = state.rows.length === 0 ? "" : String(state.rows.length);
      head.setAttribute("aria-label", state.rows.length === 0 ? t.label : t.label + " (" + String(state.rows.length) + ")");
      head.setAttribute("aria-expanded", state.collapsed ? "false" : "true");
      head.title = state.collapsed ? t.expand : t.collapse;
      list.textContent = "";
      if (state.collapsed) return;
      if (state.rows.length === 0) {
        var empty = doc.createElement("div");
        empty.className = P + "-empty";
        empty.textContent = t.empty;
        list.appendChild(empty);
        return;
      }
      for (var i = 0; i < state.rows.length; i += 1) {
        var model = state.rows[i];
        var row = doc.createElement("div");
        row.className = P + "-row";
        row.setAttribute("data-id", model.id);
        row.setAttribute("data-missing", model.missing ? "1" : "0");
        row.title = model.missing ? model.id : t.open + ": " + model.title;
        var icon = doc.createElement("span");
        icon.className = P + "-pin";
        icon.innerHTML = PIN_SVG;
        var title = doc.createElement("span");
        title.className = P + "-title";
        title.textContent = model.title;
        var unpin = doc.createElement("button");
        unpin.type = "button";
        unpin.className = P + "-unpin";
        unpin.setAttribute("aria-label", t.unpin);
        unpin.title = t.unpin;
        unpin.textContent = "\u00D7";
        row.appendChild(icon);
        row.appendChild(title);
        row.appendChild(unpin);
        list.appendChild(row);
      }
    }

    // ------------------------------------------------------------------ row overlay

    /**
     * Give every session row its own pin button.
     *
     * Clicks are handled by one delegated capture listener on the document, so a
     * row React recycles keeps working and the row's own click (open session) is
     * suppressed before React's root listener sees it.
     *
     * @param doc - owning document.
     * @param region - sidebar region element.
     * @param pins - pin store.
     * @param t - dictionary.
     * @returns `{ scanned, painted }` — session rows seen and buttons placed.
     */
    function syncRowButtons(doc, region, pins, t) {
      var snapshot = pins.getSnapshot();
      var rows = region.querySelectorAll('[role="treeitem"]');
      var painted = 0;
      for (var i = 0; i < rows.length; i += 1) {
        var row = rows[i];
        var id = sessionIdOfRow(row, snapshot);
        if (id === null) continue;
        var pinned = pins.isPinned(id);
        var button = row.querySelector("." + P + "-rowpin");
        if (button === null) {
          button = doc.createElement("button");
          button.type = "button";
          button.className = P + "-rowpin";
          button.innerHTML = PIN_SVG;
          row.insertBefore(button, row.firstElementChild);
        }
        button.setAttribute("data-id", id);
        button.className = P + "-rowpin" + (pinned ? " " + P + "-rowpin-on" : "");
        button.setAttribute("aria-pressed", pinned ? "true" : "false");
        button.title = pinned ? t.unpin : t.pin;
        button.setAttribute("aria-label", button.title);
        painted += 1;
      }
      return { scanned: rows.length, painted: painted };
    }

    // ------------------------------------------------------------------ session header toggle

    /**
     * Build the session-header pin toggle. The slot hands it the owning
     * `sessionId`, so this surface needs no DOM matching at all.
     * @param t - dictionary.
     * @param pins - pin store.
     * @returns the component.
     */
    function createHeaderButton(t, pins) {
      return function PinHeaderButton(props) {
        var sessionId = props.sessionId;
        var pinned = React.useSyncExternalStore(pins.subscribe, function () {
          return pins.isPinned(sessionId);
        });
        var label = pinned ? t.unpin : t.pin;
        return React.createElement(
          "button",
          {
            type: "button",
            className: P + "-header" + (pinned ? " " + P + "-rowpin-on" : ""),
            title: label,
            "aria-label": label,
            "aria-pressed": pinned ? "true" : "false",
            onClick: function (event) {
              event.stopPropagation();
              pins.toggle(sessionId);
            }
          },
          React.createElement("span", { dangerouslySetInnerHTML: { __html: PIN_SVG } })
        );
      };
    }

    /**
     * Open a session, tolerating both the 0.1.5 and the newer client seam.
     * @param ctx - client plugin context.
     * @param id - session id.
     * @param warn - diagnostics sink.
     */
    function openSession(ctx, id, warn) {
      var sessions = ctx.sessions;
      if (typeof sessions.open === "function") {
        sessions.open(id);
        return;
      }
      if (typeof sessions.retain === "function") {
        sessions.retain(id, { source: "gateway" });
        return;
      }
      warn("no session-open seam on this baseline");
    }

    // ------------------------------------------------------------------ plugin

    /** Client services this plugin waits for. */
    var inject = ["slots", "sessions", "settingsScope"];

    /**
     * Mount the block, the row buttons, and the header toggle.
     * @param ctx - client plugin context.
     */
    function apply(ctx) {
      var storage = guardedStorage();
      var t = dictFor(typeof navigator === "object" ? navigator.language : "");
      var debug = storage.get(DEBUG_KEY) === "1";

      // Diagnostics are always on: a pane that cannot be placed must say why
      // instead of silently disappearing. Each distinct message logs once.
      var diagnostics = {
        version: VERSION,
        collapsed: storage.get(COLLAPSE_KEY) === "1",
        paneConnected: false,
        paneParent: null,
        paneNextSibling: null,
        anchors: null,
        seat: null,
        seatLabel: null,
        skipped: [],
        rail: false,
        rows: 0,
        rowButtons: 0,
        styleNode: false,
        pinned: 0,
        ignoredPosition: storage.get(POSITION_KEY),
        notes: []
      };
      window.__dshSidebarPins = diagnostics;
      var reported = Object.create(null);
      var report = function (message) {
        if (reported[message] === true) return;
        reported[message] = true;
        diagnostics.notes.push(message);
        ctx.logger.warn("dsh-sidebar-pins: " + message);
      };
      var warn = function (message) {
        if (debug) ctx.logger.warn("dsh-sidebar-pins: " + message);
      };

      installStyle(storage);

      var pins = createPinStore(ctx, storage, warn);
      var collapsed = diagnostics.collapsed;
      var block = null;
      var schedule = null;
      /** Seat that worked last time; tried first on the next pass. */
      var seatPreference = 0;
      /** True while the sidebar is a rail: the pane keeps to its header line. */
      var railMode = false;
      /** Signature of the last paint, so an unchanged pane is not rebuilt. */
      var lastPaintKey = null;

      /**
       * Paint the pane, but only when what it shows actually changed: rebuilding
       * the list is itself a DOM mutation, and every mutation schedules another
       * pass — without this guard the pane would rebuild itself eight times a
       * second for as long as the page lives.
       */
      var repaint = function () {
        if (block === null) return;
        var snapshot = pins.getSnapshot();
        var rows = rowModels(snapshot.ids, snapshot.byId);
        var hidden = collapsed || railMode;
        var parts = [];
        for (var i = 0; i < rows.length; i += 1) {
          parts.push(rows[i].id + "\u0001" + rows[i].title + "\u0001" + (rows[i].missing ? "1" : "0"));
        }
        var key = (hidden ? "h" : "v") + (railMode ? "r" : "l") + "\u0002" + parts.join("\u0003");
        if (key === lastPaintKey) return;
        lastPaintKey = key;
        paintBlock(document, block, { rows: rows, collapsed: hidden, rail: railMode, t: t });
      };

      /** Describe one element for the diagnostics object. */
      var describe = function (node) {
        if (node === null || node === undefined) return null;
        return node.tagName + "." + String(node.className).split(/\s+/).slice(0, 2).join(".");
      };

      /**
       * Read one element's client rect without ever throwing.
       * @param node - element or null.
       * @returns the rect, or null when it cannot be measured.
       */
      var rectOf = function (node) {
        if (node === null || node === undefined || typeof node.getBoundingClientRect !== "function") return null;
        try {
          return node.getBoundingClientRect();
        } catch (error) {
          return null;
        }
      };

      /**
       * Candidate seats, innermost level first. Every level of the anchor chain
       * up to the sidebar root is a candidate — the pane goes just ahead of the
       * branch that leads to our anchor — so the right one exists whatever
       * wrappers a build adds.
       *
       * Levels above the sidebar root are deliberately NOT seats: inserting
       * there would put the pane above the whole sidebar, which is the very bug
       * this chain replaced. The last resort appends inside the innermost
       * container that stacks, so the pane always stays in the sidebar.
       * @param seat - result of {@link footerSeat}.
       * @returns the seat list.
       */
      var seatsFor = function (seat) {
        var seats = [];
        var seatAt = function (level, index) {
          return {
            label: "above the footer content (level " + String(index) + ")",
            container: level.container,
            settings: level.after,
            matches: function () {
              return block.parentElement === level.container && block.nextElementSibling === level.before;
            },
            apply: function () {
              level.container.insertBefore(block, level.before);
            }
          };
        };
        var chain = Math.min(seat.levels.length, MAX_CHAIN_SEATS);
        for (var i = 0; i < chain; i += 1) seats.push(seatAt(seat.levels[i], i));
        var fallback = null;
        for (var j = 0; j < seat.levels.length; j += 1) {
          if (stacksVertically(document, seat.levels[j].container)) {
            fallback = seat.levels[j].container;
            break;
          }
        }
        if (fallback === null) fallback = scopeOf(seat);
        seats.push({
          label: "end of the sidebar (last resort)",
          container: fallback,
          settings: null,
          matches: function () {
            return block.parentElement === fallback && fallback.lastElementChild === block;
          },
          apply: function () {
            fallback.appendChild(block);
          }
        });
        return seats;
      };

      /** Measure the pane against the block that follows it in the same container. */
      var seatSane = function (entry) {
        return seatIsSane(rectOf(block), rectOf(entry.settings));
      };

      /** A seat fits when it stacks vertically and lands the pane above the Settings row. */
      var seatFits = function (entry) {
        return stacksVertically(document, entry.container) && seatSane(entry);
      };

      /**
       * Seat the pane in the first seat that stacks it above the Settings row,
       * preferring the seat that worked last time so a settled layout costs no
       * measurement at all.
       * @param seat - result of {@link footerSeat}.
       * @returns true when the pane ended up mounted somewhere.
       */
      var place = function (seat) {
        var seats = seatsFor(seat);
        var total = seats.length;
        var preferred = seatPreference < total ? seatPreference : 0;

        // Steady state: the seat that worked last time still holds.
        if (seats[preferred].matches()) return true;
        // Some other seat holds; keep it only if it still fits, to avoid churn.
        for (var index = 0; index < total; index += 1) {
          if (index === preferred) continue;
          if (seats[index].matches() && seatFits(seats[index])) {
            seatPreference = index;
            diagnostics.seat = index;
            return true;
          }
        }
        // Seat it, checking each candidate and moving on when it does not fit.
        var rejectedForGeometry = false;
        for (var step = 0; step < total; step += 1) {
          var candidate = (preferred + step) % total;
          var entry = seats[candidate];
          if (candidate < total - 1 && !stacksVertically(document, entry.container)) {
            // Expected on the stock shell: the footer's own entries sit in a row
            // container. Recorded rather than warned about.
            diagnostics.skipped.push(entry.label);
            continue;
          }
          try {
            entry.apply();
          } catch (error) {
            report("seat \"" + entry.label + "\" refused the pane (" + String(error) + ")");
            continue;
          }
          // The last resort is accepted however it measures: a pane in the wrong
          // place is still better than a pane that is not there at all.
          if (candidate < total - 1 && !seatSane(entry)) {
            rejectedForGeometry = true;
            report("seat \"" + entry.label + "\" put the pane below the Settings row; trying the next seat");
            continue;
          }
          if (candidate !== preferred && rejectedForGeometry) {
            report("seated \"" + entry.label + "\" (the preferred seat did not land right)");
          }
          seatPreference = candidate;
          diagnostics.seat = candidate;
          diagnostics.seatLabel = entry.label;
          return true;
        }
        return block.parentElement !== null;
      };

      var attach = function () {
        // Self-healing: a style node removed by anything else would leave the
        // pane unstyled, which grows the pane to its full content height and
        // pushes the Settings row out of the sidebar.
        diagnostics.styleNode = installStyle(storage);
        var seat = footerSeat(document);
        if (seat === null) {
          diagnostics.anchors = null;
          report("waiting for the seat anchor in the sidebar footer; retrying on the next DOM change");
          return;
        }
        var chain = [];
        for (var level = 0; level < seat.levels.length; level += 1) {
          chain.push(describe(seat.levels[level].container));
        }
        diagnostics.anchors = {
          anchor: describe(seat.anchor),
          chain: chain,
          scope: describe(scopeOf(seat))
        };
        if (block === null) {
          block = createBlock(document, t, {
            toggle: function () {
              collapsed = !collapsed;
              diagnostics.collapsed = collapsed;
              storage.set(COLLAPSE_KEY, collapsed ? "1" : "0");
              repaint();
            },
            open: function (id) {
              openSession(ctx, id, warn);
            },
            unpin: function (id) {
              pins.unpin(id);
            }
          });
        }
        // Seat the pane first, then read the layout it landed in: the container
        // that holds the pane is also the one whose width says "rail" (a rail is
        // narrow), and its class is what flips between list and rail, so that is
        // what gets watched.
        if (!place(seat)) return;
        var scope = scopeOf(seat);
        if (observedRoot !== scope) {
          observedRoot = scope;
          try {
            observer.observe(observedRoot, { attributes: true, attributeFilter: ["class"] });
          } catch (error) {
            report("could not watch the sidebar root (" + String(error) + ")");
          }
        }
        railMode = isRail(block.parentElement);
        diagnostics.rail = railMode;
        block.setAttribute("data-rail", railMode ? "1" : "0");
        repaint();
        diagnostics.paneConnected = block.isConnected === true;
        diagnostics.paneParent = describe(block.parentElement);
        diagnostics.paneNextSibling = describe(block.nextElementSibling);
        diagnostics.pinned = pins.getSnapshot().ids.length;
        if (diagnostics.paneConnected !== true) report("pane is in the DOM but not connected to the document");
        var rowButtons = syncRowButtons(document, scope, pins, t);
        diagnostics.rows = rowButtons.scanned;
        diagnostics.rowButtons = rowButtons.painted;
        if (rowButtons.scanned > 0 && rowButtons.painted === 0) {
          report("saw " + String(rowButtons.scanned) + " sidebar rows but could not match any to a session");
        }
        warn(
          "attached: pinned pane + " + String(rowButtons.painted) + "/" + String(rowButtons.scanned) + " row button(s)"
        );
      };

      var observer = new MutationObserver(function () {
        if (schedule !== null) return;
        schedule = window.setTimeout(function () {
          schedule = null;
          attach();
        }, 120);
      });
      // Every way the pane can be disturbed is a mutation, so no polling timer is
      // needed: the sidebar body (removals and re-renders), the head (the style
      // node), and — per pass, in `attach` — the sidebar root's class, which is
      // what flips between the list and the rail.
      if (document.body !== null && document.body !== undefined) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
      if (document.head !== null && document.head !== undefined) {
        observer.observe(document.head, { childList: true });
      }
      var observedRoot = null;

      var onDocumentClick = function (event) {
        var target = event.target;
        if (target === null || typeof target.closest !== "function") return;
        var button = target.closest("." + P + "-rowpin");
        if (button === null) return;
        event.preventDefault();
        event.stopPropagation();
        var id = button.getAttribute("data-id");
        if (id !== null && id.length > 0) pins.toggle(id);
      };
      document.addEventListener("click", onDocumentClick, true);

      var disposePins = pins.subscribe(function () {
        repaint();
        var seat = footerSeat(document);
        if (seat !== null) syncRowButtons(document, scopeOf(seat), pins, t);
      });

      ctx.effect(
        function () {
          pins.start();
          attach();
          var disposeSlot = ctx.slots.inject("conversation.session.header.actions", function () {
            return ctx.slots.register(
              {
                name: "conversation.session.header.actions",
                id: "dsh-sidebar-pins",
                order: 51,
                inject: function () {
                  return { pins: pins, t: t };
                }
              },
              createHeaderButton(t, pins)
            );
          });
          // The seat anchor: the shell renders this slot inside the footer block,
          // so the placeholder marks the spot directly above the Settings row.
          // Until React commits it, `attach` seats the pane by the row heuristic.
          var disposeAnchor = ctx.slots.inject("sidebar.footer.action", function () {
            return ctx.slots.register(
              { name: "sidebar.footer.action", id: "dsh-sidebar-pins-anchor", order: 51 },
              createAnchor()
            );
          });
          return function () {
            observer.disconnect();
            if (schedule !== null) window.clearTimeout(schedule);
            disposeAnchor();
            disposeSlot();
            disposePins();
            pins.stop();
            document.removeEventListener("click", onDocumentClick, true);
            if (block !== null && block.parentElement !== null) block.parentElement.removeChild(block);
            block = null;
            var tag = document.getElementById(STYLE_ID);
            if (tag !== null) tag.remove();
          };
        },
        "dsh-sidebar-pins: sidebar surfaces"
      );
    }

    exports.name = "dsh-sidebar-pins";
    exports.inject = inject;
    exports.apply = apply;
    /** Test seam: pure helpers, DOM helpers, and the header component factory. */
    exports.__test = {
      normalizeIds: normalizeIds,
      decodeLegacyPinned: decodeLegacyPinned,
      rowModels: rowModels,
      sessionIndex: sessionIndex,
      sessionIdOfRow: sessionIdOfRow,
      dictFor: dictFor,
      withoutId: withoutId,
      toggleId: toggleId,
      locateParts: footerSeat,
      footerSeat: footerSeat,
      scopeOf: scopeOf,
      stacksVertically: stacksVertically,
      isRail: isRail,
      seatIsSane: seatIsSane,
      createAnchor: createAnchor,
      createBlock: createBlock,
      paintBlock: paintBlock,
      syncRowButtons: syncRowButtons,
      createHeaderButton: createHeaderButton
    };
    return module.exports;
  }
});
