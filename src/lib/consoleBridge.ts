type ConsoleLevel = 'error' | 'warn'

interface ConsoleBridgeDependencies {
  log?: (level: ConsoleLevel, message: string) => void
  isStructured: () => boolean
}

interface ConsoleErrorBridgeDependencies extends ConsoleBridgeDependencies {
  trackError: (error: Error, context: { source: 'console.error' }) => void
}

function serializeConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`
      }
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg)
        } catch {
          return String(arg)
        }
      }
      return String(arg)
    })
    .join(' ')
}

export function forwardConsoleError(
  args: unknown[],
  dependencies: ConsoleErrorBridgeDependencies,
): void {
  if (dependencies.isStructured()) return
  dependencies.log?.('error', `[Console] ${serializeConsoleArgs(args)}`)
  const error = args.find((arg): arg is Error => arg instanceof Error)
  if (error) dependencies.trackError(error, { source: 'console.error' })
}

export function forwardConsoleWarning(
  args: unknown[],
  dependencies: ConsoleBridgeDependencies,
  isDevelopment: boolean,
): void {
  if (dependencies.isStructured() || isDevelopment) return
  dependencies.log?.('warn', `[Console] ${serializeConsoleArgs(args)}`)
}
