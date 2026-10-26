// Stryker ignorer: skip mutants inside logging and i18n calls.
//
// A mutated log message or translation key is not a regression the suite should be asked to
// catch, and those string mutants would otherwise fill the survivor list. Covered:
//   log.info(...) / console.warn(...) / request.log.error(...)   (member call on log/console/logger)
//   log(...) / logError(...) / logDebug(...)                      (electron/handlers helpers)
//   t('key', ...)                                                 (src/lib/i18n)
// Logic inside the arguments of these calls is ignored with them; that is the trade.
import { PluginKind, declareValuePlugin } from '@stryker-mutator/api/plugin'

const LOG_OBJECTS = new Set(['log', 'console', 'logger'])
const LOG_FUNCTIONS = /^log([A-Z]\w*)?$/

function isLoggingCallee(callee) {
  if (callee.type === 'Identifier') return LOG_FUNCTIONS.test(callee.name) || callee.name === 't'
  if (callee.type !== 'MemberExpression') return false
  const object = callee.object
  if (object.type === 'Identifier') return LOG_OBJECTS.has(object.name)
  // request.log.error(...), fastify.log.warn(...)
  return object.type === 'MemberExpression' && object.property.type === 'Identifier' && object.property.name === 'log'
}

export const strykerPlugins = [
  declareValuePlugin(PluginKind.Ignore, 'logging', {
    shouldIgnore(path) {
      if (path.isCallExpression() && isLoggingCallee(path.node.callee)) return 'Logging or i18n call'
      return undefined
    },
  }),
]
