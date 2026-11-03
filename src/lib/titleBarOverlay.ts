/** Colours of the window controls Electron draws over the top right (Windows), per theme. */
const TITLE_BAR_OVERLAY_COLORS: Record<string, { color: string; symbolColor: string }> = {
  dark: { color: '#181818', symbolColor: '#cccccc' },
  'deep-blue': { color: '#071320', symbolColor: '#e3f2fd' },
  light: { color: '#f0f0f0', symbolColor: '#333333' },
  christmas: { color: '#1a0a0a', symbolColor: '#ff6b6b' },
  halloween: { color: '#080808', symbolColor: '#ff6b2b' },
  weather: { color: '#1c1916', symbolColor: '#fef3c7' }, // Default sunny, WeatherEffects will override
}

/** The overlay colours of an applied theme (`data-theme`), dark when it has none of its own. */
export function titleBarOverlayColors(theme: string): { color: string; symbolColor: string } {
  return TITLE_BAR_OVERLAY_COLORS[theme] ?? TITLE_BAR_OVERLAY_COLORS.dark
}
