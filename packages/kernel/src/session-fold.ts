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
          'turn/usage': () => active,
          'thread/context-window': () => active,
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
          'turn/usage': (event) => new Set(threads).add(event.thread),
          'thread/context-window': (event) => new Set(threads).add(event.thread),
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
          'turn/usage': () => projects,
          'thread/context-window': () => projects,
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
 * Per-thread token totals, summed from `turn/usage` facts on the lane.
 * `cost` is the sum of reported costs, or undefined when no turn reported one.
 */
export interface ThreadUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cost: number | undefined
}

export const foldThreadUsage = (events: readonly SessionEvent[], thread: ThreadId): ThreadUsage => {
  let inputTokens = 0
  let outputTokens = 0
  let cost: number | undefined
  for (const event of foldThreadPath(events, thread)) {
    if (event._tag !== 'turn/usage') continue
    inputTokens += event.inputTokens
    outputTokens += event.outputTokens
    if (event.cost !== undefined) cost = (cost ?? 0) + event.cost
  }
  return { inputTokens, outputTokens, cost }
}

/**
 * The latest context-window snapshot on the lane. A fact, not a live process
 * query, so a restarted view can render fill without the harness.
 */
export interface ThreadContextWindowState {
  readonly tokens: number
  readonly contextWindow: number
}

export const foldThreadContextWindow = (
  events: readonly SessionEvent[],
  thread: ThreadId,
): ThreadContextWindowState | undefined => {
  const path = foldThreadPath(events, thread)
  for (let index = path.length - 1; index >= 0; index--) {
    const event = path[index]
    if (event?._tag === 'thread/context-window') {
      return { tokens: event.tokens, contextWindow: event.contextWindow }
    }
  }
  return undefined
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
