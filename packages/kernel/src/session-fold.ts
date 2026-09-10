import { Match } from 'effect'
import type { PluginId, ThreadId } from './primitives.ts'
import type { SessionEvent } from './session-event.ts'

export const foldActivePlugins = (events: readonly SessionEvent[]): ReadonlySet<PluginId> =>
  events.reduce(
    (active, event) =>
      Match.value(event).pipe(
        Match.tagsExhaustive({
          'plugin/activated': (event) => new Set(active).add(event.plugin),
          'plugin/deactivated': (event) => {
            const next = new Set(active)
            next.delete(event.plugin)
            return next
          },
          'thread/created': () => active,
          'turn/started': () => active,
          'message/appended': () => active,
          'tool/requested': () => active,
          'tool/completed': () => active,
        }),
      ),
    new Set<PluginId>(),
  )

export const foldNamedThreads = (events: readonly SessionEvent[]): ReadonlySet<ThreadId> =>
  events.reduce(
    (threads, event) =>
      Match.value(event).pipe(
        Match.tagsExhaustive({
          'plugin/activated': () => threads,
          'plugin/deactivated': () => threads,
          'thread/created': (event) => new Set(threads).add(event.thread),
          'turn/started': (event) => new Set(threads).add(event.thread),
          'message/appended': (event) => new Set(threads).add(event.thread),
          'tool/requested': (event) => new Set(threads).add(event.thread),
          'tool/completed': (event) => new Set(threads).add(event.thread),
        }),
      ),
    new Set<ThreadId>(),
  )
