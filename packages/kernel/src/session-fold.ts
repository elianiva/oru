import type { PluginId } from './primitives.ts'
import type { SessionEvent } from './session-event.ts'

export const foldActivePlugins = (events: readonly SessionEvent[]): ReadonlySet<PluginId> => {
  const active = new Set<PluginId>()
  for (const event of events) {
    switch (event._tag) {
      case 'plugin/activated':
        active.add(event.plugin)
        break
      case 'plugin/deactivated':
        active.delete(event.plugin)
        break
      case 'turn/started':
      case 'message/appended':
      case 'tool/requested':
      case 'tool/completed':
        break
      default: {
        const _exhaustive: never = event
        return _exhaustive
      }
    }
  }
  return active
}
