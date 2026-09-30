import ReactDOM from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from '@/components/core'
import { initAnalytics, trackError } from '@/lib/analytics'
import { isStructuredConsoleLog } from '@/lib/logger'
import { forwardConsoleError, forwardConsoleWarning } from '@/lib/consoleBridge'
import '@/index.css'

// Initialize Sentry analytics if user has consented
// Read from persisted store in localStorage
try {
  const persistedStore = localStorage.getItem('blue-plm-storage')
  if (persistedStore) {
    const parsed = JSON.parse(persistedStore)
    const state = parsed?.state
    // logSharingEnabled is the consent flag from onboarding
    if (state?.logSharingEnabled === true) {
      initAnalytics(true)
    }
  }
} catch {
  // Silently fail - analytics just won't be enabled
}

// Intercept console.error and console.warn to also send them to app logs
const originalConsoleError = console.error
const originalConsoleWarn = console.warn

console.error = (...args: unknown[]) => {
  // Call original so dev tools still work
  originalConsoleError.apply(console, args)
  try {
    forwardConsoleError(args, {
      log: (level, message) => { void window.electronAPI?.log(level, message) },
      isStructured: isStructuredConsoleLog,
      trackError,
    })
  } catch {
    // Silently fail if logging fails
  }
}

console.warn = (...args: unknown[]) => {
  // Call original so dev tools still work
  originalConsoleWarn.apply(console, args)
  try {
    forwardConsoleWarning(args, {
      log: (level, message) => { void window.electronAPI?.log(level, message) },
      isStructured: isStructuredConsoleLog,
    }, import.meta.env.DEV)
  } catch {
    // Silently fail if logging fails
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)
