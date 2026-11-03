import { useEffect } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import { titleBarOverlayColors } from '@/lib/titleBarOverlay'

/**
 * Apply theme to document and update titlebar overlay
 * - Sign-in screen: always use system theme
 * - Logged in: use the stored theme (seasonal themes are never applied by date)
 */
export function useTheme() {
  const theme = usePDMStore((s) => s.theme)
  const user = usePDMStore((s) => s.user)
  const isOfflineMode = usePDMStore((s) => s.isOfflineMode)

  // Determine if user is signed in
  const isSignedIn = !!user || isOfflineMode

  useEffect(() => {
    // Determine the actual theme to apply
    // On sign-in screen: always use system theme
    // When signed in: use stored theme
    let effectiveTheme: string

    if (!isSignedIn) {
      // Sign-in screen: always use system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      effectiveTheme = prefersDark ? 'dark' : 'light'
    } else if (theme === 'system') {
      // Signed in with system theme: check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      effectiveTheme = prefersDark ? 'dark' : 'light'
    } else if (theme === 'weather') {
      // Weather theme - set data-theme but let WeatherEffects handle colors
      effectiveTheme = 'weather'
    } else {
      effectiveTheme = theme
    }

    // Apply theme to document
    document.documentElement.setAttribute('data-theme', effectiveTheme)

    // Update titlebar overlay colors (Windows only)
    // For weather theme, WeatherEffects will override this dynamically
    window.electronAPI?.setTitleBarOverlay?.(titleBarOverlayColors(effectiveTheme))

    // Listen for system preference changes when using system theme (or on sign-in screen)
    if (!isSignedIn || theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = (e: MediaQueryListEvent) => {
        const newTheme = e.matches ? 'dark' : 'light'
        document.documentElement.setAttribute('data-theme', newTheme)
        // Also update titlebar overlay
        window.electronAPI?.setTitleBarOverlay?.(titleBarOverlayColors(newTheme))
      }
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
    return undefined
  }, [theme, isSignedIn])
}
