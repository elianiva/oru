import { Effect, Layer, Schema, Stream } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { Msgpack } from 'effect/unstable/encoding'
import type { HostEvent } from './event.ts'
import { PluginActivated, PluginDeactivated, SessionEvent } from './session-event.ts'
import { defineService } from './service.ts'

export type SessionLogError = EventJournal.EventJournalError | Schema.SchemaError

export interface SessionLog {
  readonly write: (event: SessionEvent) => Effect.Effect<void, SessionLogError>
  readonly entries: Effect.Effect<readonly SessionEvent[], SessionLogError>
  readonly changes: Stream.Stream<SessionEvent, SessionLogError>
}

export const SessionLog = defineService<SessionLog>('oru/SessionLog')

const codec = Msgpack.schema(SessionEvent)
const encodePayload = Schema.encodeEffect(codec)
const decodePayload = Schema.decodeUnknownEffect(codec)

const primaryKey = (event: SessionEvent): string => {
  switch (event._tag) {
    case 'plugin/activated':
    case 'plugin/deactivated':
      return `${event.plugin}:${event._tag}`
    default:
      return event.id
  }
}

const decodeEntry = (entry: EventJournal.Entry): Effect.Effect<SessionEvent, Schema.SchemaError> =>
  decodePayload(entry.payload)

export const fromJournal = (journal: EventJournal.EventJournal['Service']): SessionLog => ({
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
  changes: Stream.unwrap(
    journal.changes.pipe(
      Effect.map((subscription) =>
        Stream.fromSubscription(subscription).pipe(Stream.mapEffect(decodeEntry)),
      ),
    ),
  ),
})

export const appendHostEvent = (
  log: SessionLog,
  event: HostEvent,
): Effect.Effect<void, SessionLogError> => {
  switch (event._tag) {
    case 'PluginActivated':
      return log.write(PluginActivated.make({ plugin: event.plugin, scope: event.scope }))
    case 'PluginDeactivated':
      return log.write(PluginDeactivated.make({ plugin: event.plugin, scope: event.scope }))
    case 'ProviderRemoved':
      return Effect.void
    default: {
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}

export const layer = Layer.effect(
  SessionLog,
  Effect.gen(function* () {
    const journal = yield* EventJournal.EventJournal
    return fromJournal(journal)
  }),
)
