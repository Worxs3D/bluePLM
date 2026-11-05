# Render performance (nightly, CI only)

Measures what the jsdom count gates in `src/perf/` cannot: layout, paint, frame times and memory of
the real Electron app. Runs nightly in its own workflow, `.github/workflows/render-perf.yml`, on
`windows-latest`. Never launch it on a developer machine.

## How the app boots

`BLUEPLM_PERF_BUILD=1 npx vite build` emits `dist/perf.html` (entry `src/perf/app/main.ts`) instead
of `index.html`, with `vite.perf.ts` redirecting `src/lib/supabase/client.ts` to the fake. An
unpackaged main process started with `BLUEPLM_PERF_BOOT=1` (`electron/perfBoot.ts`) loads it, uses a
fresh userData folder, cancels all network requests, and has the preload expose the real API as
`electronAPIReal`. The renderer then installs:

- the test kit's typed fake Supabase (`src/test/fakeSupabase.ts`), made lenient (`lenientClient.ts`):
  an unmodelled query returns `{ error }` and is counted, never throws;
- a disk serving `buildSyntheticVault(30_000)` from memory, plus the kit's SolidWorks service fake;
- a signed-in admin with a connected vault, so the real auth listener and vault load run.

A release build has no perf entry: the workflow builds the release renderer first and fails if the
perf boot appears in it.

## What it measures (`run.ts`)

Each repetition (default 3, medians reported) is a fresh process: cold start to the vault looking
loaded, search over all files, scrolling the 30k-row result end to end (400 px per frame), expanding
a deep tree, ten row clicks with the details panel, and a realtime burst of 500 file updates. Then
one long session (default 30 min) repeats ordinary operations and samples the heap after a forced GC
every minute. Long tasks come from an in-page observer; scripting, style + layout, paint and GC
self time from DevTools traces (`traceMetrics.ts`).

## Comparison (`compare.ts`, `report.ts`)

Against the median of the last 7 main runs kept on the `perf-results` branch (`render/*.json`).
A metric is flagged only when it is over 25% worse and over its absolute floor; heap growth over the
session has fixed ceilings. A flag fails the nightly with a summary table. Nothing blocks a push or
a release.

Hosted Windows runners differ a lot: on one commit (ae3ec753) two nights measured scroll TBT 134 ms
and 11,630 ms, and every timing about 2x apart. Each result records the runner's CPU model and core
count, and once 3 main runs from the current CPU model exist the baseline uses only those.

Run by hand: Actions, "Render performance", Run workflow.

## ui-look: screenshots of any screen

`scripts/ui-look/look.ts` starts the same perf boot with `BLUEPLM_PERF_LOOK=1`: a 600-file vault, a
window that is never shown, and `window.__blueplmLook` (`src/perf/app/look.ts`) to put the app into
a named scene. Steps on the command line click, type and screenshot, so a screen can be designed and
checked by reading its PNGs. Unlike the measurement runs it is light enough for a developer machine.

```
npx tsx scripts/ui-look/look.ts --scene vault-audit-results --shot results --out ui-look-out
```

Scenes are added in `src/perf/app/look.ts`; fixture data for them in `src/perf/app/lookFixtures.ts`.

Steps beyond `--scene`/`--click`/`--fill`/`--press`/`--hover`/`--wait`/`--eval`/`--shot`:
`--rclick <sel>` (context menus), `--dblclick <sel>`, `--as <person>` (sign in as someone else, see
below). Options: `--theme dark|light`, `--dist <dir>` (below), `--size`, `--out`, `--build`, `--list`.
A boot that fails prints its stage and error instead of a bare timeout.

### Own build folder (parallel agents)

`--dist <dir>` builds the perf app into `<dir>/dist` and `<dir>/dist-electron` (and its schema shape
into `<dir>`), and runs Electron from there, so several agents can build and screenshot at once
without overwriting each other's `dist/`. `BLUEPLM_PERF_OUT=<dir>` does the same for a plain
`BLUEPLM_PERF_BUILD=1 npx vite build`. Keep `<dir>` inside the repository (`.ui-look/<name>`,
gitignored) so the main process finds `node_modules`. Build once with `--build` (about a minute),
then run without it (seconds). One Electron at a time per agent.

The build bundles the working tree as it is, other sessions' in-flight edits included: when it fails
in a file you did not touch, someone is mid-edit; retry shortly.

## Review workflow scenes

The ui-look boot carries a stateful fake of the drawing-review backend, so the whole review flow can
be driven and screenshot headlessly, by clicks or by scene. Pieces:

- `src/perf/app/lookReviewModel.ts` (+ `lookReviewTypes.ts`): the review RPCs of
  `supabase/modules/20-change-control.sql` in memory (request, respond, approve all, resubmit,
  cancel, add/remove items, update meta, queue, detail, badge, workflow status, advance,
  withdrawals, gate reviews), with the same rules, JSON shapes and `HINT` refusal codes.
- `src/perf/app/lookReviewBackend.ts`: registers them with `db.defineRpc` on the perf backend's fake
  Supabase, plus `drawing_pdf_render_get/record`, `file_version_get_dependency_closure`,
  `gate_review_complete`, `file_comment_set_resolved`, the reviewer picker's team read
  (`backend.queryOverrides`) and notifications (`notification` rows, delivered as Realtime inserts
  when their user signs in). Review PDFs download into an in-memory cache (`perfElectron.ts`).
- `src/perf/app/lookReviewFixtures.ts`: folder `P00/Assy-01/Sub-00` with drawings, parts and an
  assembly (`PMP-2000` .. `PMP-2004`), versions, a distinct stored PDF per drawing version
  (`PMP-2003.SLDDRW` has none: "missing PDF"; `PMP-2002.SLDDRW` is checked out by the author,
  `PMP-2004.SLDDRW` by Sam), colleagues Sam Rivera and Alex Kim beside the perf user and Olive Other,
  teams Mechanical Review (Sam, Alex), Quality (Olive) and Electrical (empty), and a workflow
  In Work -> In Review (review stage) -> Released, where entering Released releases the file's
  current version (`released_at`, `release_revision`, as schema 509 does).
- `src/perf/app/lookScenes/review.ts`: the scenes and `actAs`.

People: `author` (the perf user, an admin), `sam`, `alex`, `olive`. `--as sam` (or
`--eval "__blueplmLook.actAs('sam')"`) switches the store's user and teams, the fake's RPC actor and
the auth session together, reloads the queue and badge, and delivers Sam's unseen notifications as
toasts.

Every scene resets the review world and rebuilds it through the RPCs, so scenes are deterministic and
can follow each other in one run. The base world (every scene but the `-empty` ones): `housing`
(author -> Sam + Alex, all, high, due in 3 days, drawing + part, markups: 2 open pins, a reply, 1
resolved), `impeller` (author -> Mechanical team, any, urgent, overdue), `flange` (Sam -> author +
Olive, due today), `pumpCheck` (Alex -> author + Sam, urgent, overdue), `seal` (approved, still in the
review stage), `cancelled`, `kickback` (Sam asked for changes) and `nobodyLeft` (Olive withdrawn),
plus a gate review waiting on the author. Their ids: `__blueplmLook.review.ids`.

Scenes (`--list` prints all):

- Flow start: `review-flow-start` (the folder, the empty pane in the right panel).
- Pane: `review-pane-empty`, `-empty-lists`, `-empty-selection`, `-empty-error`, `-draft`,
  `-draft-warnings`, `-draft-blocked`, `-error`, `-sent`, `-submitting` (Request review held open),
  `-reviewer-search`, `-reviewer-no-access` (Olive cannot see the vault: unavailable in the
  search, and her team says so); `review-menu`.
- Toggle: `toggle-explorer-tabs`, `toggle-explorer-no-tabs`, `toggle-reviews-none`,
  `toggle-reviews-review`, `toggle-reviews-review-builder`, `toggle-workflows`.
- Queue: `reviews-overview`, `reviews-overview-empty`, `reviews-queue-awaiting`, `-requested`,
  `-teams`, `-done`, `-empty-awaiting-me`, `-empty-requested-by-me`, `-empty-my-teams`,
  `-empty-done`, `-error`, `-load-more`, `reviews-bulk`.
- Detail: `review-detail-reviewer`, `-not-owed-decided`, `-not-owed-any`, `-not-owed-carried`,
  `-not-owed-reviewer`, `-sending` (an approval past its undo window, its RPC held open), `-done`, `-activity`, `-author-kickback`, `-rejected`, `-round2`,
  `-partial`, `-approved-hold`, `-approved-advance`, `-released`, `-cancelled`, `-nobody-left`,
  `-pdf-pending`, `-unsupported`, `-preview-error`, `-error`, `-not-found`; `review-resubmit`,
  `review-resubmit-missing-pdf`, `review-resubmit-no-newer`.
- Comments: `review-comments-empty`, `-threads`, `-readonly-closed`, `-load-error`.
- Other: `gate-detail`, `review-dialogs`, `review-notifications`.
- Comments' server side (schema 514, `lookScenes/reviewComments.ts`, `lookReviewComments.ts`):
  `review-comment-notified-author`, `-reviewer` (Sam's markup reaches the author and Alex; click
  `button:has-text('Open')` to jump to the drawing), `-burst` ("4 review updates"), `-mixed` (three
  toasts, Alex's same-review comment held back by the hourly rule); `file-comments-resolve-other-vault`
  (Olive with explorer edit on another vault: no Resolve on Sam's comment) and `-this-vault`. The queue's
  "Nobody left to decide" row is in `reviews-queue-requested`. `reviews.setExplorerEdit(key, vaults)`
  limits a person's explorer edit to some vaults.

Every scene in both themes: run it twice with `--theme dark` and `--theme light`.

Helpers for `--eval`, on `__blueplmLook.review`: `checkIn('PMP-2001.SLDDRW')` checks in a new
version with its PDF (`{ pdf: false }`: without), `reviews.renderPdf(name)` records a missing PDF
(what Generate PDF does with SOLIDWORKS, which the boot does not have), `reviews.addComment({...})`,
`reviews.fail(['review_list_queue'])` makes RPCs fail, `__blueplmLook.holdRpc('review_request')` keeps
every call of an RPC open on the fake backend until `__blueplmLook.releaseRpc('review_request')` (or
`releaseRpc()` for all; a scene's reset releases any hold), so a submitting or sending state stays on
screen, `reviews.setVaultAccess('olive', false)`
withdraws a reviewer, `reviews.rpc(name, args)` calls an RPC as the current actor, `reviews.model`
is the state machine.

Adding a scene: write it in `lookScenes/review.ts` (or a new `lookScenes/<area>.ts` whose record
`look.ts` spreads in); start with `reset()`, build state with `request` / `decide` / `resubmit` /
`checkIn` as the right person, then a `show*` helper. Never set review state directly. The state
machine has its own test, `src/perf/app/lookReviewBackend.test.ts`.

### The flows, by clicks

Three steps files in `scripts/ui-look/flows/` walk the review UI end to end, one screenshot per step:

- `review-full.steps` (28 shots), the canonical flow: the author selects three files, Reviews >
  Start a review, gives it a title and message, adds Sam and Alex and sends; Sam gets the
  notification, opens the drawing, drags two markups, replies to one, requests changes on the
  drawing and approves the rest; Alex approves; the author sees what to fix, resolves Sam's comment
  (schema 512), checks in v5 and resubmits; in round 2 Sam sees round 1's comments, the
  carried-forward files (not decidable), approves, undoes and approves again; Alex approves; the
  author moves the package to Released and the files read "Released as Rev B".
- `review-gate.steps`: a workflow gate kicked back (then cancelled), approved once its required
  checklist item is ticked (with the Undo window), and rejected.
- `review-bulk.steps`: three queue rows selected, the bulk bar and the approve confirmation.

Decision buttons are found by `data-decision`; file names show with lowercase extensions (the
display preference) and `text=` is case-insensitive. A decision waits 5 s in its Undo window, so a
flow waits that long before the next person acts. Run each in both themes, and the narrow layout
with `--size 1100x760`.

```
npx tsx scripts/ui-look/look.ts --dist .ui-look/<you> --build --list
npx tsx scripts/ui-look/look.ts --dist .ui-look/<you> --theme dark --out ui-look-out/review-flow --steps scripts/ui-look/flows/review-full.steps
```

`actAs` waits for the app's own reset on a user change (App.tsx clears the open review in an
effect), so a scene can open a review right after switching user. Every screenshot first forces a
few frames, so lazily rendered PDF pages are painted in a hidden window.

A steps file holds one `--kind value` per line, unquoted, so the same file runs from PowerShell and
Git Bash. On the command line in Git Bash, set `MSYS_NO_PATHCONV=1` first, or a Playwright regex
selector like `text=/Request review/` is rewritten into a Windows path. Two steps have no UI path in
the boot and go through `--eval`: generating a missing PDF (needs SOLIDWORKS) and checking in a new
version.

Selectors are the review UI's English labels; when the UI changes, update the steps file (and the
scene helpers that click a label, `clickButton(t(...))`, follow the i18n keys on their own). If the
build fails in someone else's half-finished edit, build `HEAD` plus the harness files from a
`git archive HEAD` copy under `.ui-look/` with `BLUEPLM_PERF_OUT` pointing at your `--dist` folder.

### Right-click menu customizer

Scenes in `src/perf/app/lookContextMenu.ts` (registered in `look.ts`). They write the organization's
`settings.context_menu` (two templates, Drafting the default) into the store and the fake backend, and
the person's `contextMenuPrefs`.

- `settings-context-menu`: Settings > Right-click menu, following Drafting with Export STEP and Check In
  pinned and Copy Folder Path hidden; the preview on the right.
- `settings-context-menu-custom`: the person's own layout (STEP pinned first, a "Mine" section, two
  hidden entries) in the full editor, with the "template has changed" callout.
- `settings-context-menu-templates`: Settings > Menu templates as an admin, Drafting open in the editor.
- `settings-context-menu-drag` / `settings-context-menu-dropped`: the editor's drag and drop through
  real DOM drag events (Open dragged onto the top edge of Export STEP): mid-drag with the drop line,
  then dropped (the scene throws unless Open is first).
- `context-menu-list-default`, `context-menu-list-custom`, `context-menu-list-flyout` (Export STEP's
  flyout open) and `context-menu-tree-custom`: the real right-click menus of the file list and the
  explorer tree, opened by a `contextmenu` event on the part's row, with the app default or a
  person's layout (Export STEP first, a "Mine" flyout).

Shoot the menus and drags as the whole window (`--shot name`) after `--wait 600` or more: element
shots (`name@sel`) can come back as the wrong crop of a hidden window.

```
npx tsx scripts/ui-look/look.ts --build --scene settings-context-menu --shot user --out <dir>
npx tsx scripts/ui-look/look.ts --scene settings-context-menu --click "text=Pin an action" --fill "input[type=search]=step" --shot picker --out <dir>
npx tsx scripts/ui-look/look.ts --scene settings-context-menu-custom --click "[data-editor-row='e:generate.local.step'] button >> nth=0" --wait 600 --shot selected --out <dir>
npx tsx scripts/ui-look/look.ts --scene settings-context-menu-drag --wait 900 --shot drag --scene settings-context-menu-dropped --wait 900 --shot dropped --out <dir>
npx tsx scripts/ui-look/look.ts --scene context-menu-list-flyout --wait 600 --shot flyout --out <dir>
npx tsx scripts/ui-look/look.ts --scene settings-context-menu-custom --click "text=Add group" --shot group-dialog --out <dir>
npx tsx scripts/ui-look/look.ts --eval "__blueplmLook.store.getState().setTheme('light')" --scene settings-context-menu-templates --shot light --out <dir>
npx tsx scripts/ui-look/look.ts --size 1100x800 --scene settings-context-menu --shot narrow --out <dir>
```

## Orders scenes

The Orders module (schema 513) runs on the same boot against an in-memory model of its RPCs, so
every screen and the whole add, generate, send and export flow can be driven headlessly. Pieces:

- `src/perf/app/lookOrdersModel.ts`: the `supply_order_*` RPCs of
  `supabase/migrations/0513_supply_orders.sql` over the fake's `supply_order` and
  `supply_order_line` rows (`schemaShape.ts` adds both tables until `gen:types` has them), with the
  same rules, JSON shapes and `HINT` codes (`MISSING_OUTPUTS` carries its list in `details`). Not
  modelled: module access and RLS. Lines RLS would hide are a per-order count that only
  `line_count` (and the server's missing list) sees.
- `src/perf/app/lookOrdersFixtures.ts`: on the review folder's files, STEP outputs with real stored
  bytes for some model versions, the drawing-to-model `file_version_reference` rows the planner
  pairs on, three suppliers, and the world every scene starts from: one order in every status, a
  draft by Sam, and the main draft `pumpBuild` (ready, missing and unchosen outputs, a line pinned
  to an older version, a purged line, two lines in an unreadable vault).
- `src/perf/app/lookScenes/orders.ts`: the scenes; a fake `orders:export` that downloads every
  signed URL from the fake bucket and checks its SHA-256; a query override for the planner's
  embedded reference read.

Scenes: `orders-empty`, `orders-list` (filter All), `orders-detail-draft`, `orders-detail-sent`,
`orders-send-dialog-missing`, `orders-context-menu` (file list, Orders submenu open),
`orders-version-history` (a part's history, the Order menu of its latest version), `orders-loading`,
`orders-error` (list and order), `orders-web` (no Electron bridge: no Generate, no Save to folder),
`orders-narrow` (run with `--size 1000x760`: the drawing and note columns fold into the item cell),
`orders-flow-start`.

```
npx tsx scripts/ui-look/look.ts --dist .ui-look/<you> --theme dark --scene orders-detail-draft --shot draft --out <dir>
npx tsx scripts/ui-look/look.ts --dist .ui-look/<you> --size 1000x760 --scene orders-narrow --shot narrow --out <dir>
npx tsx scripts/ui-look/look.ts --dist .ui-look/<you> --theme light --steps scripts/ui-look/flows/orders-full.steps --out <dir>
```

The flow (`orders-full.steps`): right-click three files, Orders > New order with these 3 files, add
DXF in a line's outputs menu, set a quantity, Generate missing, record the outputs, Mark sent (the
server refuses: the DXF is missing), Send anyway, Export zip.

Helpers for `--eval`, on `window.__blueplmLookOrders`: `ids` (order ids by key), `renderMissing()`
records every missing PDF and STEP of the drafts (what Generate missing does with SOLIDWORKS,
which the boot does not have), `plan(['PMP-2000.SLDASM'])` runs the line planner on review files
and returns its lines or error, `lastExport` is the request Export zip sent, `model` the RPC model
(`model.failing.add('supply_order_create')` makes an RPC fail).
