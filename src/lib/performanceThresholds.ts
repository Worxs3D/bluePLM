// 500 hid exactly the frames that feel like hover lag (100-500 ms), leaving a user report of a
// sluggish cursor with nothing in the log. Lower now, with a per-minute cap in longTaskMonitor.
export const LOAF_FRAME_THRESHOLD_MS = 150
export const LOAF_LOG_CAP_PER_MINUTE = 20
export const STORE_MUTATION_THRESHOLD_MS = 250
export const PERSIST_WRITE_THRESHOLD_MS = 100
export const REACT_COMMIT_THRESHOLD_MS = 200
export const WATCHDOG_DRIFT_THRESHOLD_MS = 2000
