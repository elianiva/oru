import { Match, Schema } from 'effect'
import { ThreadId, type EventId } from './primitives.ts'
import { MessageAppended, SessionEvent, ThreadBranched, ThreadCompacted } from './session-event.ts'

export const HostLane = Schema.TaggedStruct('host', {})
export const ThreadLane = Schema.TaggedStruct('thread', { id: ThreadId })
export const Lane = Schema.Union([HostLane, ThreadLane])
export type Lane = typeof Lane.Type

export const threadLane = (thread: ThreadId): Lane => ThreadLane.make({ id: thread })

const sameLane = (left: Lane, right: Lane): boolean =>
  Match.value(left).pipe(
    Match.tagsExhaustive({
      host: () => Schema.is(HostLane)(right),
      thread: (lane) => Schema.is(ThreadLane)(right) && lane.id === right.id,
    }),
  )

export const laneOf = (event: SessionEvent): Lane =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      'plugin/activated': () => HostLane.make({}),
      'plugin/deactivated': () => HostLane.make({}),
      'project/created': () => HostLane.make({}),
      'project/updated': () => HostLane.make({}),
      'project/deleted': () => HostLane.make({}),
      'thread/created': (event) => threadLane(event.thread),
      'thread/configured': (event) => threadLane(event.thread),
      'turn/started': (event) => threadLane(event.thread),
      'turn/failed': (event) => threadLane(event.thread),
      'turn/usage': (event) => threadLane(event.thread),
      'thread/context-window': (event) => threadLane(event.thread),
      'message/appended': (event) => threadLane(event.thread),
      'tool/requested': (event) => threadLane(event.thread),
      'tool/completed': (event) => threadLane(event.thread),
      'approval/decided': (event) => threadLane(event.thread),
      'thread/compacted': (event) => threadLane(event.thread),
      'thread/branched': (event) => threadLane(event.thread),
      'agent/inbox/spliced': (event) => threadLane(event.thread),
    }),
  )

export const threadOf = (event: SessionEvent): ThreadId | undefined => {
  const lane = laneOf(event)
  if (Schema.is(HostLane)(lane)) return undefined
  return lane.id
}

export const leafOf = (events: readonly SessionEvent[], lane: Lane): EventId | null => {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event !== undefined && sameLane(laneOf(event), lane)) return event.id
  }
  return null
}

const byIdOf = (events: readonly SessionEvent[]): ReadonlyMap<EventId, SessionEvent> =>
  new Map(events.map((event) => [event.id, event]))

const pathIn = (
  byId: ReadonlyMap<EventId, SessionEvent>,
  leafId: EventId,
): readonly SessionEvent[] => {
  const path: SessionEvent[] = []
  const seen = new Set<EventId>()
  let current: EventId | null = leafId
  while (current !== null) {
    if (seen.has(current)) break
    seen.add(current)
    const event = byId.get(current)
    if (event === undefined) break
    path.push(event)
    current = event.parentId
  }
  return path.reverse()
}

export const pathFromLeaf = (
  events: readonly SessionEvent[],
  leafId: EventId,
): readonly SessionEvent[] => pathIn(byIdOf(events), leafId)

export const pathOfLane = (
  events: readonly SessionEvent[],
  lane: Lane,
): readonly SessionEvent[] => {
  const leaf = leafOf(events, lane)
  if (leaf === null) return []
  return pathFromLeaf(events, leaf)
}

const compactedView = (path: readonly SessionEvent[]): readonly SessionEvent[] => {
  let compacted: Extract<SessionEvent, { _tag: 'thread/compacted' }> | undefined
  for (let index = path.length - 1; index >= 0; index--) {
    const event = path[index]
    if (Schema.is(ThreadCompacted)(event)) {
      compacted = event
      break
    }
  }
  if (compacted === undefined) return path
  const keptIndex = path.findIndex((event) => event.id === compacted.firstKeptEntryId)
  const tail = keptIndex === -1 ? path : path.slice(keptIndex)
  return [compacted, ...tail.filter((event) => event.id !== compacted.id)]
}

const ancestorsOf = (
  byId: ReadonlyMap<EventId, SessionEvent>,
  fromId: EventId,
  seen: ReadonlySet<EventId>,
): readonly SessionEvent[] => {
  if (seen.has(fromId)) return []
  const next = new Set(seen).add(fromId)
  const chain = pathIn(byId, fromId)
  const inherited: SessionEvent[] = []
  for (const event of chain) {
    if (!Schema.is(ThreadBranched)(event)) continue
    inherited.push(...ancestorsOf(byId, event.fromId, next))
  }
  return compactedView([...inherited, ...chain])
}

const memoryOf = (events: readonly SessionEvent[], thread: ThreadId): readonly SessionEvent[] => {
  const byId = byIdOf(events)
  const leaf = leafOf(events, threadLane(thread))
  const path = leaf === null ? [] : pathIn(byId, leaf)
  const inherited: SessionEvent[] = []
  for (const event of path) {
    if (!Schema.is(ThreadBranched)(event)) continue
    inherited.push(...ancestorsOf(byId, event.fromId, new Set()))
  }
  return compactedView([...inherited, ...path])
}

/** The facts this thread's model reads, including lanes continued through `thread/branched`. */
export const modelVisiblePath = (
  events: readonly SessionEvent[],
  thread: ThreadId,
): readonly SessionEvent[] => memoryOf(events, thread)

/**
 * The entry a compaction of this thread leaves visible: its latest request, so
 * the model keeps what it is being asked and the summary carries the rest. A
 * thread with no request of its own keeps its leaf.
 */
export const compactionCut = (
  events: readonly SessionEvent[],
  thread: ThreadId,
): EventId | undefined => {
  const path = modelVisiblePath(events, thread)
  for (let index = path.length - 1; index >= 0; index--) {
    const event = path[index]
    if (Schema.is(MessageAppended)(event) && event.role === 'user') return event.id
  }
  return path.at(-1)?.id
}

export const relink = (event: SessionEvent, seq: number, parentId: EventId | null): SessionEvent =>
  Schema.decodeUnknownSync(SessionEvent)({
    ...event,
    parentId,
    seq,
    timestamp: seq,
  })

export const chain = (events: readonly SessionEvent[]): readonly SessionEvent[] => {
  const linked: SessionEvent[] = []
  for (const event of events) {
    const parent = linked.at(-1)
    linked.push(relink(event, linked.length, parent === undefined ? null : parent.id))
  }
  return linked
}

export const unsignedTree = {
  parentId: null,
  seq: 0,
  timestamp: 0,
} as const
