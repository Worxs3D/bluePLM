# Render performance nightly (report)

Nightly job measuring the real Electron app on `windows-latest`, over a 30k-file synthetic vault
with the test kit's fakes (no network, signed in as a test admin). On main: 86a4f412, 86683442,
92d7a432, f17b5bf1, 74c066bb. How it works: `scripts/render-perf/README.md`.

## Status

- `nightly.yml` → job `render-perf` (calls `render-perf.yml`; dispatch alone with `suite=render-perf`).
  Run 40288345978 on 74c066bb completed every measurement and recorded the first baseline on the
  `perf-results` branch (`render/2026-10-26T083328Z-74c066bb-40288345978.json`).
- It is **red on purpose**: only the two heap ceilings fail, and that is a real leak (below). The
  ceilings were not raised to make it green.
- The release build is checked to contain no perf boot on every run.
- Unit tests: `scripts/render-perf/analysis.test.ts` (trace breakdown, streaming trace parser,
  frame/heap stats, comparison, source maps), `src/perf/app/backend.test.ts`, `appBoot.test.tsx`
  (the real App booted over the fakes in jsdom), `electron/perfBootFlag.test.ts`. Full suite on
  Modal: 3,574 passed. Late in the work Modal hit its workspace spend limit, so the last analysis
  test change ran as a local backup (one file, 3 s); main's CI was green on 86683442.

## Baseline (run 40288345978, median of 3; Windows runner, no GPU)

| | |
|---|---:|
| Launch to vault looks loaded | 3,223 ms (page start: 2,611 ms) |
| Cold start long tasks / TBT / longest | 7 / 1,082 ms / 423 ms |
| Cold start scripting / layout+style / paint | 2,079 / 210 / 64 ms |
| Search all 30k: to idle / TBT | 333 / 109 ms |
| Scroll 30k-row result end to end (400 px per frame) | 19 fps, p50 47 ms, p95 78 ms, 4,776 dropped frames |
| Scroll scripting / layout+style / paint | 22.6 s / 38.8 s / 27.7 s over 107 s |
| Expand a deep tree (16 folders): to idle | 95 ms, TBT 0 |
| Click a row: to idle (median / max) | 134 / 216 ms |
| Realtime burst of 500 updates: to idle / TBT | 3,659 / 1,652 ms (17 long tasks, longest 247 ms) |
| 30-min session: heap after GC | 97 → 585 MB (+489 MB, 165 MB per 10 min) |
| 30-min session: TBT | 272 s (4,413 long tasks) |

## What is slow

1. **Heap leak tied to realtime updates and expanded folders.** Over the 30-minute session the
   heap (after a forced GC) grows linearly: 97 → 218 → 330 → 425 → 516 → 592 MB. Three sessions
   reproduced it (+822 MB, +160 MB in 12 min, +489 MB). Per-step deltas: the realtime steps retain
   about 540 MB and "collapse all folders" releases about 570 MB. Live allocations at the end, from
   a source-mapped sampling heap profile:
   - 189 MB + ~60 MB: the `folderMetrics` memo in
     `src/features/source/explorer/file-tree/hooks/useVaultTree.ts:253` (FileTree);
   - 99 MB: `buildIndex` in `src/features/source/browser/utils/folderIndex.ts:45`
     (via `useSorting.ts:68`, FilePane);
   - 55 MB: `applyServerPdmUpdates` (`src/stores/serverPdmUpdate.ts:107`) from realtime.
   Each realtime update builds a new files array and a new full-vault metrics map and folder index.
   Something keyed to expanded folders keeps old generations reachable until a collapse. The
   retainer is not pinned yet. A heap snapshot retainer walk is the next step. The rising heap
   also explains the session's TBT: GC and recomputation get slower as it grows.
2. **Scrolling a large list is about 19 fps on the runner.** Per frame: ~15 ms style recalc
   (`UpdateLayoutTree`), ~5 ms layout, ~13 ms paint/layerize, ~11 ms script. Style recalc
   dominates, which points at how much DOM and how many classes each row mounts, not at React
   alone. The jsdom render-count gate already showed every mounted row re-rendering on each commit
   (`FilePaneContext`). The runner has no GPU, so absolute paint is pessimistic. The comparison
   between nights is what counts.
3. **A burst of 500 realtime updates blocks for 1.7 s** in 17 long tasks: one store write, and one
   full-vault folder metrics and index rebuild, per event.
4. **Cold start**: 2.6 s from page start to the vault on screen, 2.1 s of it script and 7 long
   tasks (longest 423 ms). This is the merge and load pipeline; `src/perf/` gates its counts.

## Limits

- The disk is served from memory, so cold start leaves out the real file scan and hashing. The
  measurement covers the renderer only.
- Calls the fakes do not model return errors and are listed in each run's summary. The most
  frequent: `get_google_drive_settings` (called ~50 times per session), `update_last_online`, and
  embedded selects for user sessions and reviews.
- History needs a few nights before the 25% comparison means much. Until then only the ceilings
  can fail.
- `.cursor/plans/` is gitignored; this file is force-added so it is on main as asked.
