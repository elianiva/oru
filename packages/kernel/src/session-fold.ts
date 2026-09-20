import { Match, Schema } from 'effect'
import {
  PERSONAL_PROJECT_ID,
  PERSONAL_PROJECT_NAME,
  ProjectId,
  type PluginId,
  type ThreadId,
} from './primitives.ts'
import {
  ProjectCreated,
  ProjectDeleted,
  ProjectUpdated,
  ThreadBranched,
  ThreadConfigured,
  ThreadContextWindow,
  ThreadCreated,
  TurnUsage,
  type SessionEvent,
} from './session-event.ts'
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
          'project/updated': () => active,
          'project/deleted': () => active,
          'thread/created': () => active,
          'thread/configured': () => active,
          'turn/started': () => active,
          'turn/failed': () => active,
          'turn/usage': () => active,
          'thread/context-window': () => active,
          'message/appended': () => active,
          'tool/requested': () => active,
          'tool/completed': () => active,
          'approval/decided': () => active,
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
          'project/updated': () => threads,
          'project/deleted': () => threads,
          'thread/created': (event) => new Set(threads).add(event.thread),
          'thread/configured': (event) => new Set(threads).add(event.thread),
          'turn/started': (event) => new Set(threads).add(event.thread),
          'turn/failed': (event) => new Set(threads).add(event.thread),
          'turn/usage': (event) => new Set(threads).add(event.thread),
          'thread/context-window': (event) => new Set(threads).add(event.thread),
          'message/appended': (event) => new Set(threads).add(event.thread),
          'tool/requested': (event) => new Set(threads).add(event.thread),
          'tool/completed': (event) => new Set(threads).add(event.thread),
          'approval/decided': (event) => new Set(threads).add(event.thread),
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
          'project/updated': () => projects,
          'project/deleted': (event) => {
            const next = new Set(projects)
            next.delete(event.project)
            return next
          },
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
          'approval/decided': () => projects,
          'thread/compacted': () => projects,
          'thread/branched': () => projects,
          'agent/inbox/spliced': () => projects,
        }),
      ),
    new Set<ProjectId>(),
  )

export const NamedProject = Schema.Struct({
  id: ProjectId,
  name: Schema.NonEmptyString,
  cwd: Schema.NonEmptyString,
  icon: Schema.optional(Schema.String),
})
export type NamedProject = typeof NamedProject.Type

/**
 * Every project the log names, as of each project's latest fact. An update to
 * an id the log never created names nothing, so it is dropped rather than
 * manufacturing a project out of a fact about one.
 */
export const foldProjects = (events: readonly SessionEvent[]): readonly NamedProject[] => {
  const projects = new Map<ProjectId, NamedProject>()
  for (const event of events) {
    if (Schema.is(ProjectCreated)(event)) {
      if (!projects.has(event.project)) {
        projects.set(event.project, {
          id: event.project,
          name: event.name,
          cwd: event.cwd,
          icon: event.icon,
        })
      }
    } else if (Schema.is(ProjectUpdated)(event) && projects.has(event.project)) {
      projects.set(event.project, {
        id: event.project,
        name: event.name,
        cwd: event.cwd,
        icon: event.icon,
      })
    } else if (Schema.is(ProjectDeleted)(event)) {
      projects.delete(event.project)
    }
  }
  return [...projects.values()]
}

export const foldProject = (
  events: readonly SessionEvent[],
  project: ProjectId,
): NamedProject | undefined => foldProjects(events).find((entry) => entry.id === project)

export const personalProject = (cwd: string): NamedProject => ({
  id: PERSONAL_PROJECT_ID,
  name: PERSONAL_PROJECT_NAME,
  cwd,
})

/**
 * The personal fact to write when the log names none. Undefined when the log
 * already names it, so seeding the same journal twice writes once.
 */
export const ensurePersonalProject = (
  events: readonly SessionEvent[],
  cwd: string,
): NamedProject | undefined =>
  foldProject(events, PERSONAL_PROJECT_ID) === undefined ? personalProject(cwd) : undefined

/** When the log first named the project, as a timestamp. Undefined when never created. */
export const foldProjectCreatedAt = (
  events: readonly SessionEvent[],
  project: ProjectId,
): number | undefined => {
  for (const event of events) {
    if (Schema.is(ProjectCreated)(event) && event.project === project) return event.timestamp
  }
  return undefined
}

/** The threads the log created against the project, oldest first. */
export const foldProjectThreads = (
  events: readonly SessionEvent[],
  project: ProjectId,
): ReadonlyArray<ThreadId> => {
  const threads: Array<ThreadId> = []
  for (const event of events) {
    if (Schema.is(ThreadCreated)(event) && event.project === project) threads.push(event.thread)
  }
  return threads
}

/**
 * What new threads in the project start with: the latest `thread/configured`
 * fact on any of the project's threads. The host remembers the last options
 * used here, so a project with no configured thread has no defaults.
 */
export const foldProjectThreadDefaults = (
  events: readonly SessionEvent[],
  project: ProjectId,
): ThreadConfig | undefined => {
  const threads = new Set(foldProjectThreads(events, project))
  if (threads.size === 0) return undefined
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event !== undefined && Schema.is(ThreadConfigured)(event) && threads.has(event.thread)) {
      return { harness: event.harness, model: event.model, reasoning: event.reasoning }
    }
  }
  return undefined
}

export const foldThreadPath = (
  events: readonly SessionEvent[],
  thread: ThreadId,
): readonly SessionEvent[] => pathOfLane(events, threadLane(thread))

/**
 * What a thread is configured to run, as of its latest `thread/configured`
 * fact. Absent members mean "the harness's own default", so the reader, not
 * the log, decides what that default is.
 */
export const ThreadConfig = Schema.Struct({
  harness: Schema.UndefinedOr(Schema.NonEmptyString),
  model: Schema.UndefinedOr(Schema.NonEmptyString),
  reasoning: Schema.UndefinedOr(Schema.NonEmptyString),
})
export type ThreadConfig = typeof ThreadConfig.Type

export const foldThreadConfig = (
  events: readonly SessionEvent[],
  thread: ThreadId,
): ThreadConfig => {
  const path = foldThreadPath(events, thread)
  for (let index = path.length - 1; index >= 0; index--) {
    const event = path[index]
    if (Schema.is(ThreadConfigured)(event)) {
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
    if (!Schema.is(TurnUsage)(event)) continue
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
    if (Schema.is(ThreadContextWindow)(event)) {
      return { tokens: event.tokens, contextWindow: event.contextWindow }
    }
  }
  return undefined
}

/**
 * The working directory a thread runs in: its own override when the creation
 * or the branch carried one, otherwise its project fact.
 *
 * A harness that owns a real process (pi) is cwd-bound, so the directory is part
 * of what a turn needs, not a detail the bridge may invent.
 */
export const foldThreadCwd = (
  events: readonly SessionEvent[],
  thread: ThreadId,
): string | undefined => {
  let project: ProjectId | undefined
  let override: string | undefined
  for (const event of events) {
    if (Schema.is(ThreadCreated)(event) && event.thread === thread) {
      project = event.project
      if (event.cwd !== undefined) override = event.cwd
    }
    if (Schema.is(ThreadBranched)(event) && event.thread === thread && event.cwd !== undefined) {
      override = event.cwd
    }
  }
  if (override !== undefined) return override
  if (project === undefined) return undefined
  return foldProject(events, project)?.cwd
}
