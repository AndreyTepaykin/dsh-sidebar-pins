English | [Russian](README.ru.md)

# dsh-sidebar-pins

Self-contained pinned sessions for the DeepSeek Harness left sidebar: its own set of
pins, its own pin buttons, and a **"📌 PINNED"** block at the top of the sidebar —
instead of a pop-up that drifts into the top-right corner and closes on an outside click.

The plugin is written for **DSH 0.1.5-rc.1** and replaces `dsh-session-pin` entirely:
once it is installed, the old plugin can be removed (see "Removing the old plugin").

## Why

`dsh-session-pin` 0.7.11 cannot deliver what it promises on this core version:

* it reorders the **host** list (`workspaces.insertSessionBefore`) — and that list really
  is reordered, which is visible in `~/.dsh/storages/workspace.json`;
* but the sidebar renders the **browser** order (`dsh.workspace.view.v5`), over which the
  host list no longer has any effect — and plugins have no public API to that store;
* the `sidebar.workspaces` slot is declared by the core as `kind: "single"`, so a second
  block cannot be embedded in it;
* the `sessions.row.action` slot does not exist on 0.1.5-rc.1, so the buttons in rows are a
  DOM overlay.

## What it does

| Surface | Behaviour |
|---|---|
| "Pinned" block | Inside the sidebar footer, **above the "Settings" row**. The location is derived only from its own anchor marker: the entire chain of containers from it upwards is collected, and the panel seats itself before the branch that leads to the anchor. Containers that lay out their children in a row (the stock `footerActions` is exactly that) are skipped by measurement, so the panel does not end up beside "Settings"; levels above the sidebar root are not considered at all — otherwise the panel would sit above the whole sidebar. Height is up to 30vh, the pin list scrolls inside. Manual collapsing is remembered per-browser; in rail mode the panel shows **only the icon and the count** |
| Pin row | Click — open the session; `×` on the right — unpin (appears on hover) |
| Button in the session row | 📌 when hovering over the row — pin/unpin. The session is determined via the React fiber, with a fallback to a nested `span` with a unique title |
| Button in the session header | Toggle for pinning the open session (the `conversation.session.header.actions` slot) |
| Missing sessions | Remain in the list dimmed (raw id), so that they can be unpinned |
| Legacy panel | The floating panel, the "Pinned sessions" footer, the maroon bar, the old button in the header and the old buttons in the rows are hidden — all the pin UI is now here |

The plugin writes nothing to the session log, does not access the network and does not affect
requests to the model.

## Storage

* The primary location is its **own** settings namespace `sidebar-pins` (registered by the host
  half), that is, pins are durable and visible in `~/.dsh/settings.yaml`.
* If the client cannot see the namespace (the host half did not mount, remote browser) —
  fallback to `localStorage["dsh.sidebar-pins.pinned"]`.
* On first launch the set is **migrated once** from `session-pin` (by the host half, before the
  page opens), so pins survive removal of the old plugin. The migration proceeds only while the
  `pinned` field has not appeared in the user layer: a deliberately emptied set is never
  filled again.

## Installation

From GitHub:

```powershell
dsh plugin --profile web add github:AndreyTepaykin/dsh-sidebar-pins
```

From npm (once the package is published):

```powershell
dsh plugin --profile web add dsh-sidebar-pins
```

For local development — from the directory holding the plugin working copy:

```powershell
dsh plugin --profile web add .
```

Then **restart DSH** (the client bundle reaches the page when the boot graph is rebuilt) and
refresh the GUI page.

## Verification

```powershell
node --test "test/*.test.mjs"                                     # 43 tests
dsh --profile web --dump-config | Select-String "sidebar-pins"    # loader row
```

Directly above the "Settings" button, "📌 PINNED (3)" will appear — a panel 30vh high
with scrolling; the session list stays above.

If the panel is missing, the plugin **will say why itself** — in the browser console:

```js
__dshSidebarPins
```

The diagnostics object (`window.__dshSidebarPins`) is always populated: `paneConnected`,
`paneParent`, `anchors` (the anchor and the chain of containers up to it), `seat`/`seatLabel`
(which location was chosen), `skipped` (locations discarded as row containers), `rail`,
`rows` and `rowButtons` (how many sidebar rows are visible and on how many the button appeared),
`styleNode`, `pinned`, `ignoredPosition` and `notes` with all warnings. Verbose logging is enabled
separately:

```js
localStorage.setItem("dsh.sidebar-pins.debug", "1");
location.reload();
```

Moreover, the panel self-restores **without polling on a timer**: everything that can remove it
is a DOM change, so exactly three targets are observed: the document body (panel removal/redraw),
`head` (the style node) and the sidebar root class (the list ↔ rail transition). Any of these
changes puts the panel and the style back in place.

## Settings (browser, localStorage)

| Key | Value |
|---|---|
| `dsh.sidebar-pins.collapsed` | `1` — the panel is collapsed to the header row |
| `dsh.sidebar-pins.show-legacy` | `1` — do not hide the `dsh-session-pin` legacy surfaces |
| `dsh.sidebar-pins.debug` | `1` — write verbose diagnostics to the console |

`dsh.sidebar-pins.position` is **no longer read**: the panel location is fixed. A value left in
localStorage from a previous version is shown in the diagnostics as `ignoredPosition` and has no
effect on anything.

## Removing the old plugin

```powershell
dsh plugin --profile web remove dsh-session-pin
```

The order matters: first make sure the block and the buttons work (the pins have been migrated),
then remove it. After removal, an unused `session-pin` section will remain in
`~/.dsh/settings.yaml` — it can be deleted manually, the plugin does not read it.

## Limitations

* **The main list is not reordered.** Pinned sessions live in the panel at the bottom and remain
  in the regular list: the browser order lives in the core's props-store, which is inaccessible to
  plugins.
* **The panel height is up to `30vh`** (the sidebar occupies the window height), not a fixed number
  of pixels; if the sidebar is short, the panel yields space rather than squeezing "Settings" off
  the edge. A collapsed panel (and any panel in rail mode) occupies only the header row.
* Session row identification relies on the React fiber (`__reactFiber$…`, React 18) with a fallback
  to **any nested** `span` with a unique title: with duplicate titles the button will not appear
  (instead of guessing). The button in the session header does not depend on this heuristic.
* **In rail mode there are no session rows in the DOM at all** — there is nothing to mark with a
  button there, so the 📌 in rows appears when the sidebar is expanded (`rows: 0` in the
  diagnostics in rail mode is normal, not a failure).
* The panel location is derived **only from its own anchor marker** and depends neither on session
  rows nor on wrappers. The live host adds an extra nameless `div` around the sidebar root and one
  `div` around each entry of the footer slot, while `footerActions` itself lays out its children
  **in a row**. Therefore, instead of a fixed chain, the entire path upwards from the anchor is
  collected, and the location is chosen by measurement: the container must lay out its children in
  a column (otherwise the panel would lie beside "Settings"), and the panel must end up above the
  "Settings" row. Levels above the sidebar root are not considered: from there the panel would
  land above the whole sidebar. The chosen location and the discarded ones are visible in the
  diagnostics (`seat`, `seatLabel`, `skipped`), and the last resort is the end of the nearest
  "column" container, that is, the panel stays inside the sidebar. The style node is reinstalled on
  every pass: a panel without styles would grow to fit its content and squeeze "Settings" off the
  edge.
* The plugin **deliberately imports no external package at all**. With a `link:` install into the
  profile this is also forced: Node resolves bare imports from the package's real path (the working
  copy), where there is no `node_modules`, and the entry would fail to load with
  `ERR_MODULE_NOT_FOUND`. That is why the settings schema is written by hand (see below) — an
  npm/git install lifts the constraint, but the hand-written schema stays so that behaviour does
  not depend on how the plugin was installed.

## Serialized schema

The host half serves a schema envelope written by hand — it must match what the schemastery built
into the shell re-hydrates. Verification:

```powershell
node scripts/check-schema-envelope.mjs
```

The script loads the **same** vendored code from `dsh-client-ui-settings/lib/client.js`,
re-hydrates the envelope and checks `{pinned:["a","b"]}`, `{}`, `{pinned:[1]}`.
The same test is in the suite (`test/host.test.mjs`) and is skipped if the shell is not present on
the machine. **Run it after updating DSH.**

## Development

```powershell
node --test "test/*.test.mjs"
```

43 tests: pure helpers (id normalization, legacy document parsing, row models, dictionary, toggle),
the host half (registration, schema, migration, envelope), the chain of locations from its own
anchor (including the extra wrappers of the live host and the absence of session rows), rejection
of row containers, seating above the "Settings" row, the geometric check and the transition to the
next location, the last resort inside the sidebar, behaviour in rail mode (icon and count only),
no redraw without changes, observed targets, restoration of removed panel and style node, buttons
in rows (fiber / nested title / ambiguity), the delegated click, the header button, fallback to
localStorage and unmounting.
