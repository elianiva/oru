import type { PluginId, ThreadId } from './primitives.ts'
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
      case 'thread/created':
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

export const foldNamedThreads = (events: readonly SessionEvent[]): ReadonlySet<ThreadId> => {
  const threads = new Set<ThreadId>()
  for (const event of events) {
    switch (event._tag) {
      case 'plugin/activated':
      case 'plugin/deactivated':
        break
      case 'thread/created':
      case 'turn/started':
      case 'message/appended':
      case 'tool/requested':
      case 'tool/completed':
        threads.add(event.thread)
        break
      default: {
        const _exhaustive: never = event
        return _exhaustive
      }
    }
  }
  return threads
}
