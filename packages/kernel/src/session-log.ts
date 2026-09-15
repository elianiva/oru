import { Clock, Context, Effect, Layer, Match, Schema, Semaphore, Stream, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { Msgpack } from 'effect/unstable/encoding'
import type { HostEvent } from './event.ts'
import {
  PluginActivated as SessionPluginActivated,
  PluginDeactivated as SessionPluginDeactivated,
  SessionEvent,
} from './session-event.ts'
import { laneOf, leafOf } from './session-tree.ts'
import { newId } from './id.ts'

export type SessionLogError = EventJournal.EventJournalError | Schema.SchemaError

export interface SessionLogContract {
  readonly write: (event: SessionEvent) => Effect.Effect<void, SessionLogError>
  readonly entries: Effect.Effect<readonly SessionEvent[], SessionLogError>
  readonly subscribe: Effect.Effect<
    Stream.Stream<SessionEvent, SessionLogError>,
    never,
    Scope.Scope
  >
  readonly changes: Stream.Stream<SessionEvent, SessionLogError>
}

export class SessionLog extends Context.Service<SessionLog, SessionLogContract>()(
  'oru/SessionLog',
) {}

const codec = Msgpack.schema(SessionEvent)
const encodePayload = Schema.encodeEffect(codec)
const decodePayload = Schema.decodeUnknownEffect(codec)

const decodeEntry = (entry: EventJournal.Entry) => decodePayload(entry.payload)

const stamp = (
  event: SessionEvent,
  events: readonly SessionEvent[],
  timestamp: number,
): Effect.Effect<SessionEvent, Schema.SchemaError> => {
  const seq = events.length
  const parentId = leafOf(events, laneOf(event))
  return Schema.decodeUnknownEffect(SessionEvent)({
    ...event,
    parentId,
    seq,
    timestamp,
  })
}

export const fromJournal = (journal: EventJournal.EventJournal['Service']): SessionLogContract => {
  const lock = Semaphore.makeUnsafe(1)
  const subscribe = journal.changes.pipe(
    Effect.map((subscription) =>
      Stream.fromSubscription(subscription).pipe(Stream.mapEffect(decodeEntry)),
    ),
  )
  return {
    write: (event) =>
      lock.withPermit(
        Effect.gen(function* () {
          const encoded = yield* journal.entries.pipe(Effect.flatMap(Effect.forEach(decodeEntry)))
          const timestamp = yield* Clock.currentTimeMillis
          const stamped = yield* stamp(event, encoded, timestamp)
          const payload = yield* encodePayload(stamped)
          yield* journal.write({
            event: stamped._tag,
            primaryKey: stamped.id,
            payload,
            effect: () => Effect.void,
          })
        }),
      ),
    entries: journal.entries.pipe(Effect.flatMap(Effect.forEach(decodeEntry))),
    subscribe,
    changes: Stream.unwrap(subscribe),
  }
}

export const appendHostEvent = (log: SessionLogContract, event: HostEvent) =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      PluginActivated: (event) =>
        newId().pipe(
          Effect.flatMap((id) =>
            log.write(
              SessionPluginActivated.make({
                id,
                plugin: event.plugin,
                scope: event.scope,
                parentId: null,
                seq: 0,
                timestamp: 0,
              }),
            ),
          ),
        ),
      PluginDeactivated: (event) =>
        newId().pipe(
          Effect.flatMap((id) =>
            log.write(
              SessionPluginDeactivated.make({
                id,
                plugin: event.plugin,
                scope: event.scope,
                parentId: null,
                seq: 0,
                timestamp: 0,
              }),
            ),
          ),
        ),
      ProviderRemoved: () => Effect.void,
    }),
  )

export const layer = Layer.effect(SessionLog, Effect.map(EventJournal.EventJournal, fromJournal))
