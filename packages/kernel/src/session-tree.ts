import { Match, Schema } from 'effect'
import { ThreadId, type EventId } from './primitives.ts'
import { SessionEvent } from './session-event.ts'

export const HostLane = Schema.TaggedStruct('host', {})
export const ThreadLane = Schema.TaggedStruct('thread', { id: ThreadId })
export const Lane = Schema.Union([HostLane, ThreadLane])
export type Lane = typeof Lane.Type

export const threadLane = (thread: ThreadId): Lane => ThreadLane.make({ id: thread })

const sameLane = (left: Lane, right: Lane): boolean => {
  if (left._tag === 'host') return right._tag === 'host'
  return right._tag === 'thread' && left.id === right.id
}

export const laneOf = (event: SessionEvent): Lane =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      'plugin/activated': () => HostLane.make({}),
      'plugin/deactivated': () => HostLane.make({}),
      'project/created': () => HostLane.make({}),
      'thread/created': (event) => threadLane(event.thread),
      'thread/configured': (event) => threadLane(event.thread),
      'turn/started': (event) => threadLane(event.thread),
      'turn/failed': (event) => threadLane(event.thread),
      'message/appended': (event) => threadLane(event.thread),
      'tool/requested': (event) => threadLane(event.thread),
      'tool/completed': (event) => threadLane(event.thread),
      'thread/compacted': (event) => threadLane(event.thread),
      'thread/branched': (event) => threadLane(event.thread),
      'agent/inbox/spliced': (event) => threadLane(event.thread),
    }),
  )

export const threadOf = (event: SessionEvent): ThreadId | undefined => {
  const lane = laneOf(event)
  if (lane._tag === 'host') return undefined
  return lane.id
}

export const leafOf = (events: readonly SessionEvent[], lane: Lane): EventId | null => {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event !== undefined && sameLane(laneOf(event), lane)) return event.id
  }
  return null
}

export const pathFromLeaf = (
  events: readonly SessionEvent[],
  leafId: EventId,
): readonly SessionEvent[] => {
  const byId = new Map(events.map((event) => [event.id, event]))
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

export const pathOfLane = (
  events: readonly SessionEvent[],
  lane: Lane,
): readonly SessionEvent[] => {
  const leaf = leafOf(events, lane)
  if (leaf === null) return []
  return pathFromLeaf(events, leaf)
}

export const modelVisiblePath = (
  events: readonly SessionEvent[],
  thread: ThreadId,
): readonly SessionEvent[] => {
  const path = pathOfLane(events, threadLane(thread))
  let compacted: Extract<SessionEvent, { _tag: 'thread/compacted' }> | undefined
  for (let index = path.length - 1; index >= 0; index--) {
    const event = path[index]
    if (event?._tag === 'thread/compacted') {
      compacted = event
      break
    }
  }
  if (compacted === undefined) return path
  const keptIndex = path.findIndex((event) => event.id === compacted.firstKeptEntryId)
  const tail = keptIndex === -1 ? path : path.slice(keptIndex)
  return [compacted, ...tail.filter((event) => event.id !== compacted.id)]
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
