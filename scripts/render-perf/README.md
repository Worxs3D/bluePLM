# Render performance (nightly, CI only)

Measures what the jsdom count gates in `src/perf/` cannot: layout, paint, frame times and memory of
the real Electron app. Runs in `.github/workflows/render-perf.yml`, called from `nightly.yml` on
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

Run by hand: Actions, "Render performance", Run workflow (or `nightly.yml` with suite `render-perf`).
