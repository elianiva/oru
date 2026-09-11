import { Match } from 'effect'
import type { PluginId, ProjectId, ThreadId } from './primitives.ts'
import type { SessionEvent } from './session-event.ts'
import { pathOfLane, threadLane } from './session-tree.ts'

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
          'project/created': () => active,
          'thread/created': () => active,
          'turn/started': () => active,
          'turn/failed': () => active,
          'message/appended': () => active,
          'tool/requested': () => active,
          'tool/completed': () => active,
          'thread/compacted': () => active,
          'thread/branched': () => active,
          'agent/inbox/spliced': () => active,
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
          'project/created': () => threads,
          'thread/created': (event) => new Set(threads).add(event.thread),
          'turn/started': (event) => new Set(threads).add(event.thread),
          'turn/failed': (event) => new Set(threads).add(event.thread),
          'message/appended': (event) => new Set(threads).add(event.thread),
          'tool/requested': (event) => new Set(threads).add(event.thread),
          'tool/completed': (event) => new Set(threads).add(event.thread),
          'thread/compacted': (event) => new Set(threads).add(event.thread),
          'thread/branched': (event) => new Set(threads).add(event.thread),
          'agent/inbox/spliced': (event) => new Set(threads).add(event.thread),
        }),
      ),
    new Set<ThreadId>(),
  )

export const foldNamedProjects = (events: readonly SessionEvent[]): ReadonlySet<ProjectId> =>
  events.reduce(
    (projects, event) =>
      Match.value(event).pipe(
        Match.tagsExhaustive({
          'project/created': (event) => new Set(projects).add(event.project),
          'plugin/activated': () => projects,
          'plugin/deactivated': () => projects,
          'thread/created': (event) => new Set(projects).add(event.project),
          'turn/started': () => projects,
          'turn/failed': () => projects,
          'message/appended': () => projects,
          'tool/requested': () => projects,
          'tool/completed': () => projects,
          'thread/compacted': () => projects,
          'thread/branched': () => projects,
          'agent/inbox/spliced': () => projects,
        }),
      ),
    new Set<ProjectId>(),
  )

export const foldThreadPath = (
  events: readonly SessionEvent[],
  thread: ThreadId,
): readonly SessionEvent[] => pathOfLane(events, threadLane(thread))
