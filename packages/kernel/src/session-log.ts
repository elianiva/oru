import { Context, Effect, Layer, Match, Schema, Stream, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { Msgpack } from 'effect/unstable/encoding'
import type { HostEvent } from './event.ts'
import { PluginActivated, PluginDeactivated, SessionEvent } from './session-event.ts'

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

const primaryKey = (event: SessionEvent) =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      'plugin/activated': (event) => `${event.plugin}:${event._tag}`,
      'plugin/deactivated': (event) => `${event.plugin}:${event._tag}`,
      'thread/created': (event) => event.id,
      'turn/started': (event) => event.id,
      'turn/failed': (event) => event.id,
      'message/appended': (event) => event.id,
      'tool/requested': (event) => event.id,
      'tool/completed': (event) => event.id,
    }),
  )

const decodeEntry = (entry: EventJournal.Entry) => decodePayload(entry.payload)

export const fromJournal = (journal: EventJournal.EventJournal['Service']): SessionLogContract => {
  const subscribe = journal.changes.pipe(
    Effect.map((subscription) =>
      Stream.fromSubscription(subscription).pipe(Stream.mapEffect(decodeEntry)),
    ),
  )
  return {
    write: (event) =>
      encodePayload(event).pipe(
        Effect.flatMap((payload) =>
          journal.write({
            event: event._tag,
            primaryKey: primaryKey(event),
            payload,
            effect: () => Effect.void,
          }),
        ),
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
        log.write(PluginActivated.make({ plugin: event.plugin, scope: event.scope })),
      PluginDeactivated: (event) =>
        log.write(PluginDeactivated.make({ plugin: event.plugin, scope: event.scope })),
      ProviderRemoved: () => Effect.void,
    }),
  )

export const layer = Layer.effect(SessionLog, Effect.map(EventJournal.EventJournal, fromJournal))
