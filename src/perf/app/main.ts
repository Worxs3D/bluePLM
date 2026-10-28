/**
 * Entry of `perf.html` (perf build only): install the fake backends, then start the real app
 * exactly as `index.html` does. A failed boot is left on `document.title` for the runner to report.
 */
import { installPerfBoot } from './boot'

document.documentElement.dataset.perfBootStage = 'entry'

installPerfBoot()
  .then(() => import('@/app/main'))
  .then(() => {
    document.documentElement.dataset.perfBootStage = 'app-started'
  })
  .catch((error: unknown) => {
    document.title = `perf-boot-failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
  })
