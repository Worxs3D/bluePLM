/**
 * Which SolidWorks documents have configurations to ask about.
 *
 * Parts and assemblies do. A drawing has sheets, not configurations, and asking the service for
 * them opens the drawing through Document Manager for an answer that is always "none" - or, when
 * that open fails, logs an ERROR with a `RESTART_SERVICE` recovery hint for a call nobody needed.
 */

const CONFIGURABLE_EXTENSIONS: ReadonlySet<string> = new Set(['.sldprt', '.sldasm'])

/** Whether `extension` (with or without its leading dot, any case) names a part or assembly. */
export function canHaveConfigurations(extension: string | null | undefined): boolean {
  if (!extension) return false
  const normalized = extension.toLowerCase()
  return CONFIGURABLE_EXTENSIONS.has(normalized.startsWith('.') ? normalized : `.${normalized}`)
}
