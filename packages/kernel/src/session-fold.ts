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
          'thread/configured': () => active,
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
          'thread/configured': (event) => new Set(threads).add(event.thread),
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
          'thread/configured': () => projects,
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

/** A named workspace as `project/created` recorded it. */
export interface NamedProject {
  readonly id: ProjectId
  readonly name: string
  readonly cwd: string
}

export const foldProjects = (events: readonly SessionEvent[]): readonly NamedProject[] => {
  const projects = new Map<ProjectId, NamedProject>()
  for (const event of events) {
    if (event._tag === 'project/created' && !projects.has(event.project)) {
      projects.set(event.project, { id: event.project, name: event.name, cwd: event.cwd })
    }
  }
  return [...projects.values()]
}

export const foldProject = (
  events: readonly SessionEvent[],
  project: ProjectId,
): NamedProject | undefined => foldProjects(events).find((entry) => entry.id === project)

export const foldThreadPath = (
  events: readonly SessionEvent[],
  thread: ThreadId,
): readonly SessionEvent[] => pathOfLane(events, threadLane(thread))

/**
 * What a thread is configured to run, as of its latest `thread/configured`
 * fact. Absent members mean "the harness's own default", so the reader, not
 * the log, decides what that default is.
 */
export interface ThreadConfig {
  readonly harness: string | undefined
  readonly model: string | undefined
  readonly reasoning: string | undefined
}

export const foldThreadConfig = (
  events: readonly SessionEvent[],
  thread: ThreadId,
): ThreadConfig => {
  const path = foldThreadPath(events, thread)
  for (let index = path.length - 1; index >= 0; index--) {
    const event = path[index]
    if (event?._tag === 'thread/configured') {
      return { harness: event.harness, model: event.model, reasoning: event.reasoning }
    }
  }
  return { harness: undefined, model: undefined, reasoning: undefined }
}

/**
 * The working directory a thread runs in, read back from its project fact.
 *
 * A harness that owns a real process (pi) is cwd-bound, so the directory is part
 * of what a turn needs, not a detail the bridge may invent.
 */
export const foldThreadCwd = (
  events: readonly SessionEvent[],
  thread: ThreadId,
): string | undefined => {
  let project: ProjectId | undefined
  for (const event of events) {
    if (event._tag === 'thread/created' && event.thread === thread) project = event.project
  }
  if (project === undefined) return undefined
  for (const event of events) {
    if (event._tag === 'project/created' && event.project === project) return event.cwd
  }
  return undefined
}
